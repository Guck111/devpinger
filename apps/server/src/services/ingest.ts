import type { NormalizedEvent, SourceAdapter, WebhookSubscriptionMatch } from "@devpinger/core"
import { events as eventsTable } from "@devpinger/db"
import { eq } from "drizzle-orm"
import type { db as Db } from "../db.js"
import { logger } from "../logger.js"
import { notificationsQueue } from "../queues.js"
import { getConnection } from "./connections.js"
import { persistEvent } from "./events.js"
import { verifyGithubSignature } from "./github-signature.js"
import { evaluateMutes } from "./mutes.js"
import type { OauthProvider } from "./oauth-state.js"
import { shouldSuppressForSelf } from "./self-suppression.js"
import { findActiveSubscriptionsByProvider, findSubscriptionById } from "./subscriptions.js"

export { verifyGithubSignature } from "./github-signature.js"

const githubLookup = async (
	db: typeof Db,
	signature: string,
	rawBody: string,
): Promise<WebhookSubscriptionMatch | null> => {
	const candidates = await findActiveSubscriptionsByProvider(db, "github")
	for (const sub of candidates) {
		if (!sub.webhookSecret) continue
		if (!verifyGithubSignature(signature, rawBody, sub.webhookSecret)) continue
		const connection = await getConnection(db, sub.userId, "github")
		return {
			userId: sub.userId,
			subscriptionId: sub.id,
			viewerUsername: connection?.providerUsername ?? undefined,
		}
	}
	return null
}

const jiraLookup = async (
	db: typeof Db,
	subscriptionId: string,
): Promise<WebhookSubscriptionMatch | null> => {
	const sub = await findSubscriptionById(db, subscriptionId)
	if (!sub || sub.provider !== "jira" || !sub.isActive) return null
	const connection = await getConnection(db, sub.userId, "jira")
	return {
		userId: sub.userId,
		subscriptionId: sub.id,
		viewerUsername: connection?.providerUserId ?? undefined,
	}
}

export const lookupForProvider = (
	db: typeof Db,
	provider: OauthProvider,
): ((req: {
	signature?: string
	rawBody?: string
	pathParam?: string
}) => Promise<WebhookSubscriptionMatch | null>) => {
	if (provider === "github") {
		return async (req) => {
			if (!req.signature || !req.rawBody) return null
			return githubLookup(db, req.signature, req.rawBody)
		}
	}
	return async (req) => {
		if (!req.pathParam) return null
		return jiraLookup(db, req.pathParam)
	}
}

export interface IngestInput {
	provider: OauthProvider
	adapter: SourceAdapter
	headers: Record<string, string | string[] | undefined>
	rawBody: string
	parsedBody: unknown
}

export interface IngestedEvent {
	eventId: string
	userId: string
	telegramChatId: number
	lang: "en" | "ru"
	muted: boolean
}

const markMuted = async (db: typeof Db, eventId: string): Promise<void> => {
	await db.update(eventsTable).set({ status: "muted" }).where(eq(eventsTable.id, eventId))
}

export const ingestWebhook = async (
	db: typeof Db,
	input: IngestInput,
): Promise<IngestedEvent[]> => {
	const lookup = lookupForProvider(db, input.provider)
	let events: NormalizedEvent[] = []
	try {
		events = await input.adapter.verifyAndNormalize(
			{ headers: input.headers, rawBody: input.rawBody, parsedBody: input.parsedBody },
			lookup,
		)
	} catch (err) {
		logger.error({ err, provider: input.provider }, "verifyAndNormalize failed")
		return []
	}
	if (events.length === 0) return []

	// Re-resolve the matching subscription so we know which user to attribute
	// each event to. verifyAndNormalize already validated the lookup, so the
	// second call is cheap (same SQL, hits the page cache).
	const headersSignature = input.headers["x-hub-signature-256"]
	const signature = Array.isArray(headersSignature) ? headersSignature[0] : headersSignature
	const subParam = input.headers["x-devpinger-subscription-id"]
	const pathParam = Array.isArray(subParam) ? subParam[0] : subParam
	const match = await lookup({
		signature,
		rawBody: input.rawBody,
		pathParam,
	})
	if (!match) return []

	const connection = await getConnection(db, match.userId, input.provider)
	const userRow = await db.query.users
		.findFirst({ where: (u, { eq }) => eq(u.id, match.userId) })
		.catch(() => undefined)
	const userLang: "en" | "ru" = userRow?.lang === "ru" ? "ru" : "en"
	const telegramChatId = userRow?.telegramChatId
	const notifySelfActions = userRow?.notifySelfActions ?? false

	if (!telegramChatId) {
		logger.warn({ userId: match.userId }, "user has no telegramChatId; dropping events")
		return []
	}

	const ingested: IngestedEvent[] = []
	for (const event of events) {
		if (shouldSuppressForSelf({ event, connection, notifySelfActions })) {
			logger.debug({ eventType: event.type, userId: match.userId }, "self-suppressed event")
			continue
		}
		const muteResult = await evaluateMutes(db, match.userId, event)
		const persisted = await persistEvent(db, { userId: match.userId, event })
		if (!persisted.isNew) {
			ingested.push({
				eventId: persisted.id,
				userId: match.userId,
				telegramChatId,
				lang: userLang,
				muted: muteResult.muted,
			})
			continue
		}
		if (muteResult.muted) {
			await markMuted(db, persisted.id)
		} else {
			await notificationsQueue.add(
				"deliver",
				{ eventId: persisted.id, userId: match.userId, telegramChatId, lang: userLang },
				{ jobId: `deliver-${persisted.id}`, removeOnComplete: 1000, removeOnFail: 100 },
			)
		}
		ingested.push({
			eventId: persisted.id,
			userId: match.userId,
			telegramChatId,
			lang: userLang,
			muted: muteResult.muted,
		})
	}
	return ingested
}
