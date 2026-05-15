import type { ConnectionCredentialsPayload } from "@devpinger/db"
import { connections } from "@devpinger/db"
import { and, eq, sql } from "drizzle-orm"
import { cipher } from "../crypto.js"
import type { db as Db } from "../db.js"
import type { OauthProvider } from "./oauth-state.js"

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
): Promise<void> => {
	await db
		.delete(connections)
		.where(and(eq(connections.userId, userId), eq(connections.provider, provider)))
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
