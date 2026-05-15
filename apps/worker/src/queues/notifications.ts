import type { NormalizedEvent } from "@devpinger/core"
import { events as eventsTable, users as usersTable } from "@devpinger/db"
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

interface DbEvent {
	id: string
	userId: string
	source: "github" | "jira"
	sourceEventId: string
	type: string
	priority: "high" | "medium" | "low"
	status: string
	title: string
	bodyPreview: string | null
	url: string
	scope: string | null
	actorUsername: string | null
	actorId: string | null
	metadata: unknown
	telegramMessageId: number | null
	snoozedUntil: Date | null
	createdAt: Date
}

export { type DeliveryDecision, decideDelivery } from "./decide-delivery.js"

const dbEventToNormalized = (event: DbEvent): NormalizedEvent => {
	const metadata = (event.metadata as Record<string, unknown> | null) ?? {}
	return {
		source: event.source,
		sourceEventId: event.sourceEventId,
		type: event.type,
		priority: event.priority,
		title: event.title,
		bodyPreview: event.bodyPreview ?? undefined,
		url: event.url,
		repo: event.scope
			? { id: event.scope, name: event.scope, fullName: event.scope, url: event.url }
			: undefined,
		actor: event.actorUsername
			? {
					id: event.actorId ?? event.actorUsername,
					username: event.actorUsername,
				}
			: undefined,
		metadata: { ...metadata, eventId: event.id },
		createdAt: event.createdAt,
	}
}

export const startNotificationsWorker = (connection: Redis) => {
	const destination = destinationRegistry.require("telegram")

	const worker = new Worker<NotificationJob>(
		"notifications",
		async (job) => {
			const start = Date.now()
			addBreadcrumb({
				category: "queue.notifications",
				level: "info",
				message: "job started",
				data: { jobId: job.id, eventId: job.data.eventId, userId: job.data.userId },
			})
			const [event] = (await db
				.select()
				.from(eventsTable)
				.where(eq(eventsTable.id, job.data.eventId))
				.limit(1)) as DbEvent[]
			const decision = decideDelivery(event ?? null)
			if (decision !== "deliver" || !event) {
				logger.debug({ eventId: job.data.eventId, decision }, "skipping notification")
				return
			}
			const normalized = dbEventToNormalized(event)

			const [user] = await db
				.select({ lang: usersTable.lang })
				.from(usersTable)
				.where(eq(usersTable.id, job.data.userId))
				.limit(1)
			const lang = (user?.lang as Locale | undefined) ?? job.data.lang

			const result = await destination.deliver({
				user: {
					id: job.data.userId,
					lang,
					preferences: { telegramChatId: job.data.telegramChatId },
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
					jobId: job.id,
					eventId: event.id,
					userId: job.data.userId,
					chatId: job.data.telegramChatId,
					latencyMs: Date.now() - start,
				},
				"notification delivered",
			)
		},
		{ connection, concurrency: 10 },
	)

	worker.on("failed", (job, err) => {
		logger.error({ jobId: job?.id, err }, "notification job failed")
		captureError(err, { queue: "notifications", jobId: job?.id, eventId: job?.data.eventId })
	})

	return worker
}
