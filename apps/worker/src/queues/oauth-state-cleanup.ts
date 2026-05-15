import { oauthStates } from "@devpinger/db"
import { Queue, Worker } from "bullmq"
import { lt } from "drizzle-orm"
import type { Redis } from "ioredis"
import { db } from "../db.js"
import { logger } from "../logger.js"

const TTL_MS = 10 * 60 * 1000

export const runOauthStateCleanup = async (now: Date = new Date()): Promise<number> => {
	const cutoff = new Date(now.getTime() - TTL_MS)
	const rows = await db
		.delete(oauthStates)
		.where(lt(oauthStates.createdAt, cutoff))
		.returning({ state: oauthStates.state })
	return rows.length
}

export const startOauthStateCleanupWorker = async (connection: Redis) => {
	const scheduler = new Queue("oauth-state-cleanup-scheduler", { connection })

	// Sweep every five minutes — TTL is 10 minutes, this keeps the table
	// trimmed without firing for every webhook.
	await scheduler.upsertJobScheduler(
		"oauth-state-cleanup",
		{ pattern: "*/5 * * * *" },
		{ name: "tick", data: {}, opts: { removeOnComplete: 50, removeOnFail: 20 } },
	)

	const worker = new Worker(
		"oauth-state-cleanup-scheduler",
		async () => {
			const deleted = await runOauthStateCleanup()
			if (deleted > 0) logger.info({ deleted }, "oauth_states cleanup completed")
		},
		{ connection },
	)

	worker.on("failed", (job, err) => {
		logger.error({ jobId: job?.id, err }, "oauth state cleanup failed")
	})

	return { worker, scheduler }
}
