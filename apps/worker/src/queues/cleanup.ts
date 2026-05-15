import { PLAN_LIMITS, type PlanId } from "@devpinger/core"
import { events, users } from "@devpinger/db"
import { Queue, Worker } from "bullmq"
import { and, eq, inArray, isNull, lt } from "drizzle-orm"
import type { Redis } from "ioredis"
import { db } from "../db.js"
import { logger } from "../logger.js"

const DELETE_CHUNK = 500

interface RetentionOptions {
	now?: Date
	chunkSize?: number
	maxIterationsPerPlan?: number
}

export const runEventRetention = async (
	options: RetentionOptions = {},
): Promise<{
	perPlan: Record<PlanId, number>
	hitIterationCap: PlanId[]
}> => {
	const now = options.now ?? new Date()
	const chunkSize = options.chunkSize ?? DELETE_CHUNK
	const maxIterations = options.maxIterationsPerPlan ?? 1000
	const perPlan: Record<PlanId, number> = { free: 0, personal: 0, pro: 0, team: 0 }
	const hitIterationCap: PlanId[] = []

	for (const plan of Object.keys(PLAN_LIMITS) as PlanId[]) {
		const days = PLAN_LIMITS[plan].historyDays
		if (!Number.isFinite(days)) continue
		const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

		let iter = 0
		for (; iter < maxIterations; iter++) {
			const ids = await db
				.select({ id: events.id })
				.from(events)
				.innerJoin(users, eq(users.id, events.userId))
				.where(and(eq(users.plan, plan), lt(events.createdAt, cutoff), isNull(events.snoozedUntil)))
				.limit(chunkSize)

			if (ids.length === 0) break

			const deleted = await db
				.delete(events)
				.where(
					inArray(
						events.id,
						ids.map((r) => r.id),
					),
				)
				.returning({ id: events.id })
			perPlan[plan] += deleted.length

			if (ids.length < chunkSize) break
		}
		if (iter === maxIterations) hitIterationCap.push(plan)
	}

	return { perPlan, hitIterationCap }
}

export const startCleanupWorker = async (connection: Redis) => {
	const scheduler = new Queue("cleanup-scheduler", { connection })

	await scheduler.upsertJobScheduler(
		"daily-retention-cleanup",
		{ pattern: "17 3 * * *" },
		{ name: "tick", data: {}, opts: { removeOnComplete: 50, removeOnFail: 20 } },
	)

	const worker = new Worker(
		"cleanup-scheduler",
		async () => {
			const summary = await runEventRetention()
			if (summary.hitIterationCap.length > 0) {
				logger.warn(
					{ plans: summary.hitIterationCap },
					"retention cleanup hit per-plan iteration cap — backlog remains",
				)
			}
			logger.info({ summary }, "retention cleanup completed")
		},
		{ connection },
	)

	worker.on("failed", (job, err) => {
		logger.error({ jobId: job?.id, err }, "cleanup job failed")
	})

	return { worker, scheduler }
}
