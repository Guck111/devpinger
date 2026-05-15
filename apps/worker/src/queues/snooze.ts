import { events, users as usersTable } from "@devpinger/db"
import type { Locale } from "@devpinger/i18n"
import { Queue, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import type { Redis } from "ioredis"
import { db } from "../db.js"
import { logger } from "../logger.js"

export interface SnoozeJob {
	eventId: string
	userId: string
	telegramChatId: number
	locale: Locale
}

export interface SnoozeWakeCandidate {
	status: "pending" | "delivered" | "snoozed" | "muted" | "completed" | null
}

export const shouldRedeliverOnWake = (event: SnoozeWakeCandidate | null): boolean => {
	if (!event) return false
	if (event.status === "completed") return false
	if (event.status === "muted") return false
	return true
}

export const startSnoozeWorker = (connection: Redis) => {
	const notifications = new Queue("notifications", { connection })

	const worker = new Worker<SnoozeJob>(
		"snooze",
		async (job) => {
			const { eventId, userId, telegramChatId, locale } = job.data
			const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1)
			if (!shouldRedeliverOnWake(event ?? null)) {
				logger.debug({ eventId, status: event?.status ?? null }, "snooze wake: skipped")
				return
			}
			await db
				.update(events)
				.set({ status: "pending", snoozedUntil: null, telegramMessageId: null })
				.where(eq(events.id, eventId))
			const [user] = await db
				.select({ lang: usersTable.lang })
				.from(usersTable)
				.where(eq(usersTable.id, userId))
				.limit(1)
			const lang = (user?.lang as Locale | undefined) ?? locale
			await notifications.add(
				"deliver",
				{ eventId, userId, telegramChatId, lang },
				{ removeOnComplete: 1000, removeOnFail: 100, attempts: 3 },
			)
			logger.info({ eventId }, "snooze wake: re-queued")
		},
		{ connection },
	)

	worker.on("failed", (job, err) => {
		logger.error({ jobId: job?.id, err }, "snooze job failed")
	})

	return worker
}
