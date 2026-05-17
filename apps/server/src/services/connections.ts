import type { ConnectionCredentialsPayload } from "@devpinger/db"
import { connections } from "@devpinger/db"
import { refreshAccessToken as refreshJiraToken } from "@devpinger/sources-jira"
import { and, eq, sql } from "drizzle-orm"
import { env } from "../config.js"
import { cipher } from "../crypto.js"
import type { db as Db } from "../db.js"
import { logger } from "../logger.js"
import type { OauthProvider } from "./oauth-state.js"
import { deactivateAllForUserProvider, listSubscriptions } from "./subscriptions.js"

export interface UpsertConnectionInput {
	userId: string
	provider: OauthProvider
	providerUserId: string
	providerUsername: string | null
	credentials: ConnectionCredentialsPayload
}

export const upsertConnection = async (db: typeof Db, input: UpsertConnectionInput) => {
	const encrypted = cipher.encrypt(JSON.stringify(input.credentials))
	const [row] = await db
		.insert(connections)
		.values({
			userId: input.userId,
			provider: input.provider,
			providerUserId: input.providerUserId,
			providerUsername: input.providerUsername,
			encryptedCredentials: encrypted,
		})
		.onConflictDoUpdate({
			target: [connections.userId, connections.provider],
			set: {
				providerUserId: input.providerUserId,
				providerUsername: input.providerUsername,
				encryptedCredentials: encrypted,
				updatedAt: sql`now()`,
			},
		})
		.returning()
	if (!row) throw new Error("upsertConnection returned no rows")
	return row
}

export interface ResolvedConnection {
	id: string
	userId: string
	provider: OauthProvider
	providerUserId: string
	providerUsername: string | null
	credentials: ConnectionCredentialsPayload
}

const decryptCredentials = (encrypted: string): ConnectionCredentialsPayload =>
	JSON.parse(cipher.decrypt(encrypted)) as ConnectionCredentialsPayload

export const getConnection = async (
	db: typeof Db,
	userId: string,
	provider: OauthProvider,
): Promise<ResolvedConnection | null> => {
	const [row] = await db
		.select()
		.from(connections)
		.where(and(eq(connections.userId, userId), eq(connections.provider, provider)))
		.limit(1)
	if (!row) return null
	return {
		id: row.id,
		userId: row.userId,
		provider: row.provider as OauthProvider,
		providerUserId: row.providerUserId,
		providerUsername: row.providerUsername,
		credentials: decryptCredentials(row.encryptedCredentials),
	}
}

export const listConnectedProviders = async (
	db: typeof Db,
	userId: string,
): Promise<Map<OauthProvider, { providerUsername: string | null }>> => {
	const rows = await db
		.select({
			provider: connections.provider,
			providerUsername: connections.providerUsername,
		})
		.from(connections)
		.where(eq(connections.userId, userId))
	return new Map(
		rows.map(
			(r) => [r.provider as OauthProvider, { providerUsername: r.providerUsername }] as const,
		),
	)
}

export const deleteConnection = async (
	db: typeof Db,
	userId: string,
	provider: OauthProvider,
): Promise<{ removed: boolean }> => {
	const result = await db
		.delete(connections)
		.where(and(eq(connections.userId, userId), eq(connections.provider, provider)))
		.returning({ id: connections.id })
	return { removed: result.length > 0 }
}

// Disconnect a provider end-to-end: best-effort remove webhooks at the
// provider side, deactivate orphaned subscriptions, then drop the connection.
// Subscriptions are deactivated rather than deleted so reconnect + re-add of
// the same repo/project naturally reactivates the row via onConflictDoUpdate.
// Connection is deleted LAST because webhook removal needs its credentials.
export const disconnectProvider = async (
	db: typeof Db,
	userId: string,
	provider: OauthProvider,
): Promise<{ removed: boolean }> => {
	const connection = await getConnection(db, userId, provider)
	if (connection && provider === "github") {
		const subs = await listSubscriptions(db, userId, "github")
		const active = subs.filter((s) => s.isActive)
		if (active.length > 0) {
			const { createGithubClient, removeRepoWebhook } = await import("@devpinger/sources-github")
			const client = createGithubClient({ accessToken: connection.credentials.accessToken })
			for (const sub of active) {
				const [owner, repo] = sub.providerScopeId.split("/")
				const hookId = Number(sub.webhookId)
				if (owner && repo && Number.isFinite(hookId)) {
					try {
						await removeRepoWebhook(client, { owner, repo, hookId })
					} catch (err) {
						logger.warn(
							{ err, subId: sub.id, scopeId: sub.providerScopeId },
							"github removeRepoWebhook failed during disconnect; deactivating anyway",
						)
					}
				}
			}
		}
	}
	await deactivateAllForUserProvider(db, userId, provider)
	return await deleteConnection(db, userId, provider)
}

export const updateConnectionCredentials = async (
	db: typeof Db,
	id: string,
	credentials: ConnectionCredentialsPayload,
): Promise<void> => {
	const encrypted = cipher.encrypt(JSON.stringify(credentials))
	await db
		.update(connections)
		.set({ encryptedCredentials: encrypted, updatedAt: sql`now()` })
		.where(eq(connections.id, id))
}

// Refresh window: if the access token expires within this many ms from now,
// proactively call the refresh endpoint before using it.
const JIRA_REFRESH_BUFFER_MS = 60_000

// Resolve a Jira connection and refresh its access token if it has expired
// (or is about to). Persists the new credentials before returning. If refresh
// fails, returns the existing connection so the caller can surface a
// reconnect prompt rather than crashing.
export const getFreshJiraConnection = async (
	db: typeof Db,
	userId: string,
): Promise<ResolvedConnection | null> => {
	const conn = await getConnection(db, userId, "jira")
	if (!conn) return null
	const creds = conn.credentials as ConnectionCredentialsPayload & {
		refreshToken?: string
		expiresAt?: string
	}
	if (!creds.expiresAt) return conn
	const expiresAtMs = Date.parse(creds.expiresAt)
	if (!Number.isFinite(expiresAtMs)) return conn
	if (Date.now() < expiresAtMs - JIRA_REFRESH_BUFFER_MS) return conn
	if (!creds.refreshToken) {
		logger.warn({ userId }, "jira connection has no refreshToken; user must reconnect")
		return conn
	}
	try {
		const fresh = await refreshJiraToken({
			clientId: env.JIRA_OAUTH_CLIENT_ID,
			clientSecret: env.JIRA_OAUTH_CLIENT_SECRET,
			refreshToken: creds.refreshToken,
		})
		const updated: ConnectionCredentialsPayload = {
			...creds,
			accessToken: fresh.access_token,
			refreshToken: fresh.refresh_token ?? creds.refreshToken,
			expiresAt: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
			scopes: fresh.scope ? fresh.scope.split(" ") : creds.scopes,
		}
		await updateConnectionCredentials(db, conn.id, updated)
		return { ...conn, credentials: updated }
	} catch (err) {
		logger.error({ err, userId }, "jira token refresh failed")
		return conn
	}
}
