// Atlassian Dynamic Webhooks have a hard 30-day TTL — they auto-delete unless
// we PUT /rest/api/3/webhook/refresh before then. This worker scans jira
// connections and refreshes any webhook whose `refreshedAt` is older than
// 25 days (5-day safety margin). If Atlassian reports the webhook missing
// (failedWebhooks), we clear `jiraWebhook` from credentials so the next user
// action (➕/➖ project) triggers a clean recreate through ensureJiraWebhook.
//
// This module is intentionally self-contained: the server's
// services/jira-webhooks.ts can't be imported here (different rootDir). We
// duplicate just the refresh + clear-on-missing path; create/delete remain
// in the server where they're triggered by user actions.

import { createCipher } from "@devpinger/crypto"
import { type ConnectionCredentialsPayload, connections as connectionsTable } from "@devpinger/db"
import { createJiraClient, refreshWebhook } from "@devpinger/sources-jira"
import { Queue, Worker } from "bullmq"
import { eq, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import { env } from "../config.js"
import { db } from "../db.js"
import { logger } from "../logger.js"

const cipher = createCipher(env.ENCRYPTION_KEY)

const REFRESH_THRESHOLD_MS = 25 * 24 * 60 * 60 * 1000

export interface JiraWebhookRefreshSummary {
	scanned: number
	refreshed: number
	cleared: number
	failed: number
}

const decodeCredentials = (encrypted: string): ConnectionCredentialsPayload =>
	JSON.parse(cipher.decrypt(encrypted)) as ConnectionCredentialsPayload

const writeCredentials = async (
	connectionId: string,
	creds: ConnectionCredentialsPayload,
): Promise<void> => {
	await db
		.update(connectionsTable)
		.set({
			encryptedCredentials: cipher.encrypt(JSON.stringify(creds)),
			updatedAt: sql`now()`,
		})
		.where(eq(connectionsTable.id, connectionId))
}

export const runJiraWebhookRefresh = async (
	now: Date = new Date(),
): Promise<JiraWebhookRefreshSummary> => {
	const rows = await db.select().from(connectionsTable).where(eq(connectionsTable.provider, "jira"))
	let scanned = 0
	let refreshed = 0
	let cleared = 0
	let failed = 0
	const nowMs = now.getTime()
	for (const row of rows) {
		scanned += 1
		let creds: ConnectionCredentialsPayload
		try {
			creds = decodeCredentials(row.encryptedCredentials)
		} catch (err) {
			logger.error({ err, connectionId: row.id }, "jira refresh: decrypt failed")
			failed += 1
			continue
		}
		const meta = creds.jiraWebhook
		if (!meta || meta.needsReconnect || !creds.jiraCloudId) continue
		const refreshedAtMs = Date.parse(meta.refreshedAt)
		if (!Number.isFinite(refreshedAtMs)) continue
		if (nowMs - refreshedAtMs < REFRESH_THRESHOLD_MS) continue

		const client = createJiraClient({
			accessToken: creds.accessToken,
			cloudId: creds.jiraCloudId,
		})
		try {
			const { refreshedIds, failedIds } = await refreshWebhook(client, [meta.id])
			if (refreshedIds.includes(meta.id)) {
				const next: ConnectionCredentialsPayload = {
					...creds,
					jiraWebhook: { ...meta, refreshedAt: now.toISOString() },
				}
				await writeCredentials(row.id, next)
				refreshed += 1
			} else if (failedIds.includes(meta.id)) {
				const { jiraWebhook: _omit, ...rest } = creds
				await writeCredentials(row.id, rest)
				cleared += 1
				logger.warn(
					{ connectionId: row.id, webhookId: meta.id },
					"jira refresh: webhook missing on Atlassian side; cleared local meta",
				)
			}
		} catch (err) {
			failed += 1
			logger.warn({ err, connectionId: row.id, webhookId: meta.id }, "jira refresh failed")
		}
	}
	if (refreshed + cleared + failed > 0) {
		logger.info({ scanned, refreshed, cleared, failed }, "jira webhook refresh tick")
	}
	return { scanned, refreshed, cleared, failed }
}

export const startJiraWebhookRefreshWorker = async (connection: Redis) => {
	const scheduler = new Queue("jira-webhook-refresh-scheduler", { connection })

	// Sweep every 4 hours. 25-day threshold + 30-day TTL gives ~30 tick-failures
	// of slack before any webhook risks silent expiry.
	await scheduler.upsertJobScheduler(
		"jira-webhook-refresh",
		{ pattern: "0 */4 * * *" },
		{ name: "tick", data: {}, opts: { removeOnComplete: 50, removeOnFail: 20 } },
	)

	const worker = new Worker(
		"jira-webhook-refresh-scheduler",
		async () => {
			await runJiraWebhookRefresh()
		},
		{ connection },
	)

	worker.on("failed", (job, err) => {
		logger.error({ jobId: job?.id, err }, "jira webhook refresh job failed")
	})

	return { worker, scheduler }
}
