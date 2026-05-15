import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { providerEnum } from "./connections.js"
import { users } from "./users.js"

// Audit trail of inbound webhook deliveries. Operators use this for
// debugging "I created a PR but DevPinger didn't ping me" — see if the
// hook arrived, whether we matched a user, and the final outcome.
// `user_id` is nullable because we may not know which user owns the
// delivery until after signature verification.
export const webhookResultEnum = pgEnum("webhook_result", ["matched", "no_match", "error"])

export const webhookDeliveries = pgTable("webhook_deliveries", {
	id: uuid("id").primaryKey().defaultRandom(),
	provider: providerEnum("provider").notNull(),
	sourceEventId: text("source_event_id"),
	userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
	receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
	processedAt: timestamp("processed_at", { withTimezone: true }),
	result: webhookResultEnum("result"),
	errorMessage: text("error_message"),
})

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert
