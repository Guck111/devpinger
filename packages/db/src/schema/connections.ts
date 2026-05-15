import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { users } from "./users.js"

export const providerEnum = pgEnum("provider", ["github", "jira"])

// Plaintext shape encrypted into `encrypted_credentials` (AES-256-GCM via
// @devpinger/crypto). One row per (user, provider). GitHub access tokens
// don't expire — refreshToken/expiresAt absent. Jira (Atlassian 3LO)
// access tokens live ~1h with refreshToken + jiraCloudId attached.
export interface ConnectionCredentialsPayload {
	accessToken: string
	refreshToken?: string
	expiresAt?: string
	scopes?: string[]
	jiraCloudId?: string
	installationId?: string
}

export const connections = pgTable(
	"connections",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: providerEnum("provider").notNull(),
		providerUserId: text("provider_user_id").notNull(),
		providerUsername: text("provider_username"),
		encryptedCredentials: text("encrypted_credentials").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		userProviderIdx: uniqueIndex("connections_user_provider_idx").on(table.userId, table.provider),
	}),
)

export type Connection = typeof connections.$inferSelect
export type NewConnection = typeof connections.$inferInsert
