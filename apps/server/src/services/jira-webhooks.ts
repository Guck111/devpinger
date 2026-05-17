// Orchestration for the per-(user, cloudId) Jira Dynamic Webhook lifecycle.
//
// We keep one webhook per Jira connection. Its JQL filter lists every project
// the user is actively watching. Add/remove/disconnect events mutate the set,
// then ensureJiraWebhook reconciles: create on first project, delete+create
// when the JQL changes, delete when the last project leaves. A background
// worker calls refreshJiraWebhook every few hours to keep Atlassian's 30-day
// TTL from silently expiring the webhook.
//
// Webhook id, secret, current JQL and refresh timestamp live inside the
// connection's encrypted credentials (`jiraWebhook` field) so we avoid an
// extra table or migration.

import { randomBytes } from "node:crypto"
import type { JiraWebhookMeta } from "@devpinger/db"
import {
	DEFAULT_JIRA_WEBHOOK_EVENTS,
	JiraApiError,
	buildProjectJql,
	createJiraClient,
	createWebhook,
	deleteWebhook,
	refreshWebhook,
} from "@devpinger/sources-jira"
import { env } from "../config.js"
import type { db as Db } from "../db.js"
import { logger } from "../logger.js"
import {
	getConnection,
	getFreshJiraConnection,
	updateConnectionCredentials,
} from "./connections.js"
import { listSubscriptions } from "./subscriptions.js"

export interface EnsureJiraWebhookResult {
	status: "unchanged" | "created" | "recreated" | "deleted" | "needs_reconnect" | "no_op"
}

const mintSecret = (): string => randomBytes(32).toString("base64url")

const buildCallbackUrl = (connectionId: string, secret: string): string =>
	`${env.PUBLIC_BASE_URL}/webhooks/jira/${connectionId}?secret=${secret}`

export const ensureJiraWebhook = async (
	db: typeof Db,
	userId: string,
): Promise<EnsureJiraWebhookResult> => {
	const conn = await getFreshJiraConnection(db, userId)
	if (!conn) return { status: "no_op" }
	if (!conn.credentials.jiraCloudId) {
		logger.warn({ userId }, "jira ensureWebhook: connection missing jiraCloudId")
		return { status: "no_op" }
	}

	const subs = await listSubscriptions(db, userId, "jira")
	const activeKeys = subs.filter((s) => s.isActive).map((s) => s.providerScopeId)
	const existing = conn.credentials.jiraWebhook

	// No active subscriptions: drop the webhook if any exists, nothing to register.
	if (activeKeys.length === 0) {
		if (existing) {
			await removeJiraWebhook(db, userId)
			return { status: "deleted" }
		}
		return { status: "no_op" }
	}

	const newJql = buildProjectJql(activeKeys)

	// Already registered with the right JQL and not flagged as broken? No-op.
	if (existing && existing.jql === newJql && !existing.needsReconnect) {
		return { status: "unchanged" }
	}

	const client = createJiraClient({
		accessToken: conn.credentials.accessToken,
		cloudId: conn.credentials.jiraCloudId,
	})

	// Reuse secret on re-registration so the callback URL stays stable
	// (helpful for log-correlation; Atlassian sees the same URL).
	const secret = existing?.secret ?? mintSecret()
	const url = buildCallbackUrl(conn.id, secret)

	// Best-effort delete the previous webhook before creating the new one.
	// Jira has no PATCH; recreate is the only way to change JQL.
	if (existing) {
		try {
			await deleteWebhook(client, [existing.id])
		} catch (err) {
			logger.warn(
				{ err, userId, oldWebhookId: existing.id },
				"jira ensureWebhook: deleting previous webhook failed; continuing with create",
			)
		}
	}

	let createdIds: number[]
	try {
		createdIds = await createWebhook(client, {
			url,
			registrations: [{ jqlFilter: newJql, events: DEFAULT_JIRA_WEBHOOK_EVENTS }],
		})
	} catch (err) {
		// 403 = missing `manage:jira-webhook` scope. User connected before this
		// scope was added; flag in credentials and surface to the UI.
		if (err instanceof JiraApiError && err.status === 403) {
			const flagged: JiraWebhookMeta = existing
				? { ...existing, needsReconnect: true }
				: {
						id: 0,
						secret,
						jql: newJql,
						createdAt: new Date().toISOString(),
						refreshedAt: new Date().toISOString(),
						needsReconnect: true,
					}
			await persistJiraWebhook(db, conn.id, conn.credentials, flagged)
			logger.warn({ userId }, "jira ensureWebhook: 403 — user needs to reconnect with new scope")
			return { status: "needs_reconnect" }
		}
		throw err
	}

	const newId = createdIds[0]
	if (typeof newId !== "number") {
		throw new Error("jira ensureWebhook: createWebhook returned empty id array")
	}
	const now = new Date().toISOString()
	await persistJiraWebhook(db, conn.id, conn.credentials, {
		id: newId,
		secret,
		jql: newJql,
		createdAt: existing?.createdAt ?? now,
		refreshedAt: now,
	})
	return { status: existing ? "recreated" : "created" }
}

export const removeJiraWebhook = async (db: typeof Db, userId: string): Promise<void> => {
	const conn = await getConnection(db, userId, "jira")
	if (!conn?.credentials.jiraWebhook) return
	if (!conn.credentials.jiraCloudId) {
		await persistJiraWebhook(db, conn.id, conn.credentials, undefined)
		return
	}
	const client = createJiraClient({
		accessToken: conn.credentials.accessToken,
		cloudId: conn.credentials.jiraCloudId,
	})
	try {
		await deleteWebhook(client, [conn.credentials.jiraWebhook.id])
	} catch (err) {
		logger.warn(
			{ err, userId, webhookId: conn.credentials.jiraWebhook.id },
			"jira removeWebhook: Jira DELETE failed; clearing local state anyway",
		)
	}
	await persistJiraWebhook(db, conn.id, conn.credentials, undefined)
}

export interface RefreshResult {
	status: "refreshed" | "recreated" | "no_op" | "needs_reconnect" | "error"
}

export const refreshJiraWebhook = async (db: typeof Db, userId: string): Promise<RefreshResult> => {
	const conn = await getFreshJiraConnection(db, userId)
	if (!conn?.credentials.jiraCloudId) return { status: "no_op" }
	const existing = conn.credentials.jiraWebhook
	if (!existing) {
		// Bootstrap path: connection has subscriptions but no webhook yet
		// (e.g. user from before this feature shipped). ensureJiraWebhook will
		// create one.
		const subs = await listSubscriptions(db, userId, "jira")
		if (subs.some((s) => s.isActive)) {
			const res = await ensureJiraWebhook(db, userId)
			if (res.status === "created") return { status: "recreated" }
			if (res.status === "needs_reconnect") return { status: "needs_reconnect" }
			return { status: "no_op" }
		}
		return { status: "no_op" }
	}
	if (existing.needsReconnect) return { status: "needs_reconnect" }

	const client = createJiraClient({
		accessToken: conn.credentials.accessToken,
		cloudId: conn.credentials.jiraCloudId,
	})
	try {
		const { refreshedIds, failedIds } = await refreshWebhook(client, [existing.id])
		if (failedIds.includes(existing.id)) {
			// Atlassian forgot our webhook (expired or revoked). Recreate.
			logger.info(
				{ userId, webhookId: existing.id },
				"jira refreshWebhook: webhook missing on Atlassian side; recreating",
			)
			await persistJiraWebhook(db, conn.id, conn.credentials, undefined)
			const ensured = await ensureJiraWebhook(db, userId)
			if (ensured.status === "needs_reconnect") return { status: "needs_reconnect" }
			return { status: "recreated" }
		}
		if (refreshedIds.includes(existing.id)) {
			await persistJiraWebhook(db, conn.id, conn.credentials, {
				...existing,
				refreshedAt: new Date().toISOString(),
			})
			return { status: "refreshed" }
		}
		return { status: "no_op" }
	} catch (err) {
		if (err instanceof JiraApiError && err.status === 403) {
			await persistJiraWebhook(db, conn.id, conn.credentials, {
				...existing,
				needsReconnect: true,
			})
			return { status: "needs_reconnect" }
		}
		logger.error({ err, userId }, "jira refreshWebhook failed")
		return { status: "error" }
	}
}

const persistJiraWebhook = async (
	db: typeof Db,
	connectionId: string,
	credentials: Parameters<typeof updateConnectionCredentials>[2],
	jiraWebhook: JiraWebhookMeta | undefined,
): Promise<void> => {
	const { jiraWebhook: _omitted, ...rest } = credentials
	const next = jiraWebhook ? { ...rest, jiraWebhook } : rest
	await updateConnectionCredentials(db, connectionId, next)
}
