import { users } from "@devpinger/db"
import { eq, sql } from "drizzle-orm"
import type { db as Db } from "../db.js"

export interface UpsertUserInput {
	telegramId: number
	telegramChatId: number
	telegramUsername?: string | null
	languageCode?: string | null
}

export const upsertUser = async (db: typeof Db, input: UpsertUserInput) => {
	const lang = input.languageCode?.toLowerCase().startsWith("ru") ? "ru" : "en"
	const [row] = await db
		.insert(users)
		.values({
			telegramId: input.telegramId,
			telegramChatId: input.telegramChatId,
			telegramUsername: input.telegramUsername ?? null,
			lang,
		})
		.onConflictDoUpdate({
			target: users.telegramId,
			set: {
				telegramChatId: input.telegramChatId,
				telegramUsername: input.telegramUsername ?? null,
				lastSeenAt: sql`now()`,
			},
		})
		.returning()
	if (!row) throw new Error("upsertUser returned no rows")
	return row
}

export const getUserByTelegramId = async (db: typeof Db, telegramId: number) => {
	const [row] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1)
	return row ?? null
}

export const getUserById = async (db: typeof Db, id: string) => {
	const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
	return row ?? null
}

export const updateUserLang = async (
	db: typeof Db,
	id: string,
	lang: "en" | "ru",
): Promise<void> => {
	await db.update(users).set({ lang }).where(eq(users.id, id))
}

export const setNotifySelfActions = async (
	db: typeof Db,
	id: string,
	value: boolean,
): Promise<void> => {
	await db.update(users).set({ notifySelfActions: value }).where(eq(users.id, id))
}
