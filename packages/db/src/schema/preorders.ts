import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const preorders = pgTable("preorders", {
	id: uuid("id").primaryKey().defaultRandom(),
	stripeEventId: text("stripe_event_id").notNull().unique(),
	stripeSessionId: text("stripe_session_id").unique(),
	email: text("email").notNull(),
	telegramUsername: text("telegram_username"),
	amountCents: integer("amount_cents").notNull(),
	currency: text("currency").notNull(),
	status: text("status").notNull().default("paid"),
	paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Preorder = typeof preorders.$inferSelect
export type NewPreorder = typeof preorders.$inferInsert
