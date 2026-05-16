import {
	type DbEventLike,
	dbEventToNormalized,
	events as eventsTable,
	users as usersTable,
} from "@devpinger/db"
import type { Locale } from "@devpinger/i18n"
import { Worker } from "bullmq"
import { eq, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import { db } from "../db.js"
import { logger } from "../logger.js"
import { destinationRegistry } from "../registries.js"
import { addBreadcrumb, captureError } from "../sentry.js"
import { decideDelivery } from "./decide-delivery.js"

export interface NotificationJob {
	eventId: string
	userId: string
	telegramChatId: number
	lang: Locale
}

interface DbEvent extends DbEventLike {
	userId: string
	status: string
	telegramMessageId: number | null
	snoozedUntil: Date | null
}

export { type DeliveryDecision, decideDelivery } from "./decide-delivery.js"

/**
 * Pure async function that processes a single notification job payload.
 * Exported so that integration tests can drive the same logic that the
 * BullMQ worker dispatches without spinning up a Worker instance.
 */
export const handleNotificationJob = async (
	jobData: NotificationJob,
	context: { jobId?: string } = {},
): Promise<void> => {
	const destination = destinationRegistry.require("telegram")
	const start = Date.now()
	addBreadcrumb({
		category: "queue.notifications",
		level: "info",
		message: "job started",
		data: { jobId: context.jobId, eventId: jobData.eventId, userId: jobData.userId },
	})
	const [event] = (await db
		.select()
		.from(eventsTable)
		.where(eq(eventsTable.id, jobData.eventId))
		.limit(1)) as DbEvent[]
	const decision = decideDelivery(event ?? null)
	if (decision !== "deliver" || !event) {
		logger.debug({ eventId: jobData.eventId, decision }, "skipping notification")
		return
	}
	const normalized = dbEventToNormalized(event)

	const [user] = await db
		.select({ lang: usersTable.lang })
		.from(usersTable)
		.where(eq(usersTable.id, jobData.userId))
		.limit(1)
	const lang = (user?.lang as Locale | undefined) ?? jobData.lang

	const result = await destination.deliver({
		user: {
			id: jobData.userId,
			lang,
			preferences: { telegramChatId: jobData.telegramChatId },
		},
		event: normalized,
		actions: [],
	})

	const sentMessageId = result.messageId ? Number(result.messageId) : null
	await db
		.update(eventsTable)
		.set({
			status: "delivered",
			telegramMessageId: sentMessageId,
			deliveredAt: sql`now()`,
		})
		.where(eq(eventsTable.id, event.id))
	logger.info(
		{
			queue: "notifications",
			jobId: context.jobId,
			eventId: event.id,
			userId: jobData.userId,
			chatId: jobData.telegramChatId,
			latencyMs: Date.now() - start,
		},
		"notification delivered",
	)
}

export const startNotificationsWorker = (connection: Redis) => {
	const worker = new Worker<NotificationJob>(
		"notifications",
		async (job) => handleNotificationJob(job.data, { jobId: job.id }),
		{ connection, concurrency: 10 },
	)

	worker.on("failed", (job, err) => {
		logger.error({ jobId: job?.id, err }, "notification job failed")
		captureError(err, { queue: "notifications", jobId: job?.id, eventId: job?.data.eventId })
	})

	return worker
}
