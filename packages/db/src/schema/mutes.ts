import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { users } from "./users.js"

export const muteScopeTypeEnum = pgEnum("mute_scope_type", [
	"source",
	"repo",
	"project",
	"event_type",
])

export const mutes = pgTable(
	"mutes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		scopeType: muteScopeTypeEnum("scope_type").notNull(),
		scopeValue: text("scope_value").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		userScopeIdx: uniqueIndex("mutes_user_scope_idx").on(
			table.userId,
			table.scopeType,
			table.scopeValue,
		),
	}),
)

export type Mute = typeof mutes.$inferSelect
export type NewMute = typeof mutes.$inferInsert
