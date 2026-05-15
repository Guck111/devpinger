import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const landingSubscribers = pgTable("landing_subscribers", {
	id: uuid("id").primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	source: text("source"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
})

export type LandingSubscriber = typeof landingSubscribers.$inferSelect
export type NewLandingSubscriber = typeof landingSubscribers.$inferInsert
