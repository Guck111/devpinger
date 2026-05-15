import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { providerEnum } from "./connections.js"
import { users } from "./users.js"

// Short-lived rows that protect against CSRF in the OAuth authorize → callback
// roundtrip. Cleanup worker deletes rows older than 10 minutes.
export const oauthStates = pgTable("oauth_states", {
	state: text("state").primaryKey(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	provider: providerEnum("provider").notNull(),
	codeVerifier: text("code_verifier"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type OauthState = typeof oauthStates.$inferSelect
export type NewOauthState = typeof oauthStates.$inferInsert
