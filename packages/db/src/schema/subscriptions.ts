import { sql } from "drizzle-orm"
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { providerEnum } from "./connections.js"
import { users } from "./users.js"

// One row per "thing being watched" for a user — a GitHub repo (full_name)
// or a Jira project (key). `webhook_secret` is the HMAC seed used to
// route inbound webhooks back to this user without an O(N) scan.
// `webhook_id` is the provider-side ID (used to delete the webhook on
// disconnect for GitHub; null for Jira where the route is per-cloud).
export const subscriptions = pgTable(
	"subscriptions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: providerEnum("provider").notNull(),
		providerScopeId: text("provider_scope_id").notNull(),
		displayName: text("display_name").notNull(),
		webhookId: text("webhook_id"),
		webhookSecret: text("webhook_secret"),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		userProviderScopeIdx: uniqueIndex("subscriptions_user_provider_scope_idx").on(
			table.userId,
			table.provider,
			table.providerScopeId,
		),
		// Inbound webhooks scan WHERE provider='X' AND is_active=true and then
		// HMAC-verify each row's secret. Partial index keeps that scan to the
		// O(N) slice of active rows rather than a full table sweep.
		activeByProviderIdx: index("subscriptions_active_by_provider_idx")
			.on(table.provider)
			.where(sql`${table.isActive} = true`),
	}),
)

export type Subscription = typeof subscriptions.$inferSelect
export type NewSubscription = typeof subscriptions.$inferInsert
