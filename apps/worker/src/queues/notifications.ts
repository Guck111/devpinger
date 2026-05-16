import {
	type DbEventLike,
	dbEventToNormalized,
	events as eventsTable,
	subscriptions as subscriptionsTable,
	users as usersTable,
} from "@devpinger/db"
import { type Locale, botMessages } from "@devpinger/i18n"
import { Worker } from "bullmq"
import { eq, sql } from "drizzle-orm"
import { GrammyError } from "grammy"
import type { Redis } from "ioredis"
import { db } from "../db.js"
import { logger } from "../logger.js"
import { destinationRegistry, telegramClient } from "../registries.js"
import { addBreadcrumb, captureError } from "../sentry.js"
import { maybeMarkFirstEvent } from "../services/first-event.js"
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

	let result: Awaited<ReturnType<typeof destination.deliver>>
	try {
		result = await destination.deliver({
			user: {
				id: jobData.userId,
				lang,
				preferences: { telegramChatId: jobData.telegramChatId },
			},
			event: normalized,
			actions: [],
		})
	} catch (err) {
		if (isTelegramForbidden(err)) {
			const deactivated = await db
				.update(subscriptionsTable)
				.set({ isActive: false })
				.where(eq(subscriptionsTable.userId, jobData.userId))
				.returning({ id: subscriptionsTable.id })
			logger.warn(
				{
					userId: jobData.userId,
					eventId: event.id,
					deactivatedCount: deactivated.length,
					description: getGrammyDescription(err),
				},
				"telegram 403: user blocked the bot; deactivated subscriptions",
			)
			await db.update(eventsTable).set({ status: "failed" }).where(eq(eventsTable.id, event.id))
			return
		}
		throw err
	}

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

	try {
		const { shouldSendFollowUp } = await maybeMarkFirstEvent(db, jobData.userId)
		if (shouldSendFollowUp) {
			await telegramClient.sendMessage({
				chatId: jobData.telegramChatId,
				text: botMessages[lang].onboarding.firstEvent,
				parseMode: "HTML",
			})
		}
	} catch (err) {
		logger.warn({ err, userId: jobData.userId }, "first-event follow-up failed")
	}
}

// GrammyError 403 means the user blocked the bot or deactivated their account.
// Duck-type the check so test doubles can throw plain objects with the same
// shape rather than constructing a real GrammyError.
const isTelegramForbidden = (err: unknown): boolean => {
	if (err instanceof GrammyError) return err.error_code === 403
	if (err && typeof err === "object") {
		const e = err as { name?: unknown; error_code?: unknown }
		return e.name === "GrammyError" && e.error_code === 403
	}
	return false
}

const getGrammyDescription = (err: unknown): string | undefined => {
	if (err instanceof GrammyError) return err.description
	if (err && typeof err === "object" && "description" in err) {
		const d = (err as { description?: unknown }).description
		return typeof d === "string" ? d : undefined
	}
	return undefined
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
