import { createCipher } from "@devpinger/crypto"
import {
	connections as connectionsTable,
	events as eventsTable,
	subscriptions as subscriptionsTable,
	users as usersTable,
} from "@devpinger/db"
import type { createDatabase } from "@devpinger/db"

type Db = ReturnType<typeof createDatabase>

const ENC_KEY = "0".repeat(64)
const cipher = createCipher(ENC_KEY)

const randInt = (): number => 1_000_000 + Math.floor(Math.random() * 8_000_000)
const randStr = (): string => Math.random().toString(36).slice(2, 10)

export const createTestUser = async (
	db: Db,
	overrides: Partial<typeof usersTable.$inferInsert> = {},
) => {
	const id = randInt()
	const [user] = await db
		.insert(usersTable)
		.values({
			telegramId: id,
			telegramChatId: id,
			telegramUsername: `tu_${randStr()}`,
			lang: "en",
			...overrides,
		})
		.returning()
	if (!user) throw new Error("createTestUser failed")
	return user
}

export const addGitHubConnection = async (
	db: Db,
	userId: string,
	opts: { accessToken?: string; username?: string; providerUserId?: string } = {},
) => {
	const [conn] = await db
		.insert(connectionsTable)
		.values({
			userId,
			provider: "github",
			providerUserId: opts.providerUserId ?? randStr(),
			providerUsername: opts.username ?? `gh_${randStr()}`,
			encryptedCredentials: cipher.encrypt(
				JSON.stringify({ accessToken: opts.accessToken ?? "ghp_test_token", scopes: ["repo"] }),
			),
		})
		.returning()
	if (!conn) throw new Error("addGitHubConnection failed")
	return conn
}

export const addJiraConnection = async (
	db: Db,
	userId: string,
	opts: { accessToken?: string; cloudId?: string; siteUrl?: string } = {},
) => {
	const [conn] = await db
		.insert(connectionsTable)
		.values({
			userId,
			provider: "jira",
			providerUserId: `jira_${randStr()}`,
			providerUsername: `jirau_${randStr()}`,
			encryptedCredentials: cipher.encrypt(
				JSON.stringify({
					accessToken: opts.accessToken ?? "jira_test_token",
					refreshToken: "refresh_token",
					cloudId: opts.cloudId ?? "test-cloud-id",
					siteUrl: opts.siteUrl ?? "https://test.atlassian.net",
					scopes: ["read:jira-work", "write:jira-work"],
				}),
			),
		})
		.returning()
	if (!conn) throw new Error("addJiraConnection failed")
	return conn
}

export const addSubscription = async (
	db: Db,
	userId: string,
	opts: {
		provider?: "github" | "jira"
		scope?: string
		webhookSecret?: string
		webhookId?: string | null
	} = {},
) => {
	const provider = opts.provider ?? "github"
	const scope = opts.scope ?? `tu_${randStr()}/repo`
	const [sub] = await db
		.insert(subscriptionsTable)
		.values({
			userId,
			provider,
			providerScopeId: scope,
			displayName: scope,
			webhookId: provider === "github" ? (opts.webhookId ?? "99999") : null,
			webhookSecret: opts.webhookSecret ?? `secret_${randStr()}`,
			isActive: true,
		})
		.returning()
	if (!sub) throw new Error("addSubscription failed")
	return sub
}

export const insertEvent = async (
	db: Db,
	userId: string,
	overrides: Partial<typeof eventsTable.$inferInsert> = {},
) => {
	const [e] = await db
		.insert(eventsTable)
		.values({
			userId,
			source: "github",
			sourceEventId: `seed_${randStr()}`,
			type: "pull_request.opened",
			priority: "medium",
			title: "Test PR #1",
			url: "https://github.com/test/repo/pull/1",
			scope: "test/repo",
			metadata: { prNumber: 1, number: 1 },
			...overrides,
		})
		.returning()
	if (!e) throw new Error("insertEvent failed")
	return e
}
