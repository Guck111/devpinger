import type { NormalizedEvent } from "@devpinger/core"
import { events, connections, subscriptions, users } from "@devpinger/db"
import { and, eq } from "drizzle-orm"
import type { db as Db } from "../db.js"
import type { OauthProvider } from "./oauth-state.js"

export interface ScopeSubscriber {
	userId: string
	subscriptionId: string
	telegramChatId: number
	lang: "en" | "ru"
	providerUsername: string | null
}

const scopeFromEvent = (event: NormalizedEvent): string | null => {
	if (event.source === "github") return event.repo?.fullName ?? null
	if (event.source === "jira") {
		const projectKey = (event.metadata as { projectKey?: unknown } | null | undefined)?.projectKey
		return typeof projectKey === "string" ? projectKey : null
	}
	return null
}

export const findSubscribersForScope = async (
	db: typeof Db,
	provider: OauthProvider,
	providerScopeId: string,
): Promise<ScopeSubscriber[]> => {
	const rows = await db
		.select({
			userId: users.id,
			subscriptionId: subscriptions.id,
			telegramChatId: users.telegramChatId,
			lang: users.lang,
			providerUsername: connections.providerUsername,
		})
		.from(subscriptions)
		.innerJoin(users, eq(users.id, subscriptions.userId))
		.leftJoin(
			connections,
			and(eq(connections.userId, users.id), eq(connections.provider, provider)),
		)
		.where(
			and(
				eq(subscriptions.provider, provider),
				eq(subscriptions.providerScopeId, providerScopeId),
				eq(subscriptions.isActive, true),
			),
		)
	return rows.map((r) => ({
		userId: r.userId,
		subscriptionId: r.subscriptionId,
		telegramChatId: r.telegramChatId,
		lang: r.lang,
		providerUsername: r.providerUsername,
	}))
}

export interface PersistEventInput {
	userId: string
	event: NormalizedEvent
}

export interface PersistedEvent {
	id: string
	isNew: boolean
}

export const persistEvent = async (
	db: typeof Db,
	input: PersistEventInput,
): Promise<PersistedEvent> => {
	const { event, userId } = input
	const scope = scopeFromEvent(event)
	const [row] = await db
		.insert(events)
		.values({
			userId,
			source: event.source,
			sourceEventId: event.sourceEventId,
			type: event.type,
			priority: event.priority,
			title: event.title,
			bodyPreview: event.bodyPreview ?? null,
			url: event.url,
			scope,
			actorUsername: event.actor?.username ?? null,
			actorId: event.actor?.id ?? null,
			metadata: event.metadata,
		})
		.onConflictDoNothing({
			target: [events.userId, events.source, events.sourceEventId],
		})
		.returning({ id: events.id })
	if (row) return { id: row.id, isNew: true }

	// Existed already — fetch its id so the worker can still address it.
	const [existing] = await db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				eq(events.userId, userId),
				eq(events.source, event.source),
				eq(events.sourceEventId, event.sourceEventId),
			),
		)
		.limit(1)
	if (!existing) throw new Error("persistEvent: row missing after conflict")
	return { id: existing.id, isNew: false }
}
