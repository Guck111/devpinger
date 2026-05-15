import {
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { providerEnum } from "./connections.js"
import { users } from "./users.js"

export const priorityEnum = pgEnum("priority", ["high", "medium", "low"])
export const eventStatusEnum = pgEnum("event_status", [
	"pending",
	"delivered",
	"muted",
	"snoozed",
	"completed",
])

export const events = pgTable(
	"events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		source: providerEnum("source").notNull(),
		sourceEventId: text("source_event_id").notNull(),
		type: text("type").notNull(),
		priority: priorityEnum("priority").notNull().default("medium"),
		status: eventStatusEnum("status").notNull().default("pending"),
		title: text("title").notNull(),
		bodyPreview: text("body_preview"),
		url: text("url").notNull(),
		scope: text("scope"),
		actorUsername: text("actor_username"),
		actorId: text("actor_id"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
		telegramMessageId: integer("telegram_message_id"),
		snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		userSourceEventIdx: uniqueIndex("events_user_source_event_idx").on(
			table.userId,
			table.source,
			table.sourceEventId,
		),
	}),
)

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
