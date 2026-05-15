import type { EventSource } from "@devpinger/core"
import { PLAN_LIMITS, type PlanId } from "@devpinger/core"
import { events } from "@devpinger/db"
import { and, desc, eq, gte, sql } from "drizzle-orm"
import type { db as Db } from "../db.js"

export interface HistoryEvent {
	id: string
	source: EventSource
	type: string
	priority: "high" | "medium" | "low"
	title: string
	url: string
	scope: string | null
	actorUsername: string | null
	createdAt: Date
	status: string
}

const retentionCutoff = (plan: PlanId): Date => {
	const days = PLAN_LIMITS[plan].historyDays
	if (!Number.isFinite(days)) return new Date(0)
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

const historyProjection = {
	id: events.id,
	source: events.source,
	type: events.type,
	priority: events.priority,
	title: events.title,
	url: events.url,
	scope: events.scope,
	actorUsername: events.actorUsername,
	createdAt: events.createdAt,
	status: events.status,
}

export const recentEvents = async (
	db: typeof Db,
	userId: string,
	plan: PlanId,
	limit = 20,
): Promise<HistoryEvent[]> => {
	const since = retentionCutoff(plan)
	return db
		.select(historyProjection)
		.from(events)
		.where(and(eq(events.userId, userId), gte(events.createdAt, since)))
		.orderBy(desc(events.createdAt))
		.limit(limit)
}

export const searchEvents = async (
	db: typeof Db,
	userId: string,
	plan: PlanId,
	query: string,
	limit = 10,
): Promise<HistoryEvent[]> => {
	const cleaned = query.trim()
	if (!cleaned) return []
	const since = retentionCutoff(plan)
	return db
		.select(historyProjection)
		.from(events)
		.where(
			and(
				eq(events.userId, userId),
				gte(events.createdAt, since),
				sql`to_tsvector('simple', coalesce(${events.title}, '') || ' ' || coalesce(${events.bodyPreview}, '')) @@ plainto_tsquery('simple', ${cleaned})`,
			),
		)
		.orderBy(desc(events.createdAt))
		.limit(limit)
}

export interface UserStats {
	total: number
	delivered: number
	muted: number
	highPriority: number
	mediumPriority: number
	lowPriority: number
	bySource: Record<EventSource, number>
}

const zeroStats = (): UserStats => ({
	total: 0,
	delivered: 0,
	muted: 0,
	highPriority: 0,
	mediumPriority: 0,
	lowPriority: 0,
	bySource: { github: 0, jira: 0 },
})

export const userStats = async (
	db: typeof Db,
	userId: string,
	plan: PlanId,
): Promise<UserStats> => {
	const since = retentionCutoff(plan)
	const rows = await db
		.select({
			source: events.source,
			priority: events.priority,
			status: events.status,
		})
		.from(events)
		.where(and(eq(events.userId, userId), gte(events.createdAt, since)))

	const out = zeroStats()
	for (const row of rows) {
		out.total++
		if (row.status === "delivered") out.delivered++
		if (row.status === "muted") out.muted++
		if (row.priority === "high") out.highPriority++
		if (row.priority === "medium") out.mediumPriority++
		if (row.priority === "low") out.lowPriority++
		out.bySource[row.source as EventSource]++
	}
	return out
}
