import type { NormalizedEvent } from "@devpinger/core"
import { mutes } from "@devpinger/db"
import { type MuteResult, type MuteRule, applyMutes } from "@devpinger/shared"
import { and, eq } from "drizzle-orm"
import type { db as Db } from "../db.js"

const loadMutes = async (db: typeof Db, userId: string): Promise<MuteRule[]> => {
	const rows = await db.select().from(mutes).where(eq(mutes.userId, userId))
	return rows.map((r) => ({
		id: r.id,
		scopeType: r.scopeType,
		scopeValue: r.scopeValue,
	}))
}

export const evaluateMutes = async (
	db: typeof Db,
	userId: string,
	event: NormalizedEvent,
): Promise<MuteResult> => {
	const rules = await loadMutes(db, userId)
	return applyMutes(event, rules)
}

export const addMute = async (
	db: typeof Db,
	userId: string,
	scopeType: MuteRule["scopeType"],
	scopeValue: string,
): Promise<{ created: boolean }> => {
	const [row] = await db
		.insert(mutes)
		.values({ userId, scopeType, scopeValue })
		.onConflictDoNothing({ target: [mutes.userId, mutes.scopeType, mutes.scopeValue] })
		.returning({ id: mutes.id })
	return { created: Boolean(row) }
}

export const removeMute = async (
	db: typeof Db,
	userId: string,
	scopeType: MuteRule["scopeType"],
	scopeValue: string,
): Promise<{ removed: boolean }> => {
	const rows = await db
		.delete(mutes)
		.where(
			and(
				eq(mutes.userId, userId),
				eq(mutes.scopeType, scopeType),
				eq(mutes.scopeValue, scopeValue),
			),
		)
		.returning({ id: mutes.id })
	return { removed: rows.length > 0 }
}

export const listMutes = async (db: typeof Db, userId: string): Promise<MuteRule[]> => {
	return loadMutes(db, userId)
}
