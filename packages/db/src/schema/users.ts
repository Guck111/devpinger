import { sql } from "drizzle-orm"
import { bigint, boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const planEnum = pgEnum("plan", ["free", "personal", "pro", "team"])
export const langEnum = pgEnum("lang", ["en", "ru"])

export const users = pgTable("users", {
	id: uuid("id").primaryKey().defaultRandom(),
	telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
	telegramChatId: bigint("telegram_chat_id", { mode: "number" }).notNull(),
	telegramUsername: text("telegram_username"),
	lang: langEnum("lang").notNull().default("en"),
	timezone: text("timezone").notNull().default("UTC"),
	notifySelfActions: boolean("notify_self_actions").notNull().default(false),
	plan: planEnum("plan").notNull().default("free"),
	planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(sql`now()`),
	onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
	firstEventNotifiedAt: timestamp("first_event_notified_at", { withTimezone: true }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
