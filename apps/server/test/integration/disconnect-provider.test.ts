import { createCipher } from "@devpinger/crypto"
import {
	type ConnectionCredentialsPayload,
	connections as connectionsTable,
	createDatabase,
	subscriptions as subscriptionsTable,
} from "@devpinger/db"
import { and, eq, sql } from "drizzle-orm"
import nock from "nock"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mockGitHubDeleteWebhook, mockJiraDeleteWebhook } from "./helpers/nock-helpers.js"
import {
	addGitHubConnection,
	addJiraConnection,
	addSubscription,
	createTestUser,
} from "./helpers/seed.js"

const cipher = createCipher("0".repeat(64))

const seedJiraWebhookMeta = async (
	db: ReturnType<typeof createDatabase>,
	connectionId: string,
	meta: { id: number; secret: string; jql: string },
) => {
	const [row] = await db
		.select()
		.from(connectionsTable)
		.where(eq(connectionsTable.id, connectionId))
		.limit(1)
	if (!row) throw new Error("connection not found")
	const creds = JSON.parse(cipher.decrypt(row.encryptedCredentials)) as ConnectionCredentialsPayload
	const next: ConnectionCredentialsPayload = {
		...creds,
		jiraWebhook: {
			...meta,
			createdAt: new Date().toISOString(),
			refreshedAt: new Date().toISOString(),
		},
	}
	await db
		.update(connectionsTable)
		.set({
			encryptedCredentials: cipher.encrypt(JSON.stringify(next)),
			updatedAt: sql`now()`,
		})
		.where(eq(connectionsTable.id, connectionId))
}

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("disconnectProvider: cleans up orphaned subscriptions", () => {
	let db: ReturnType<typeof createDatabase>
	let disconnectProvider: typeof import("../../src/services/connections.js").disconnectProvider

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const connections = await import("../../src/services/connections.js")
		disconnectProvider = connections.disconnectProvider
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("deactivates only github subscriptions, removes github webhooks, deletes only github connection", async () => {
		const user = await createTestUser(db)
		await addGitHubConnection(db, user.id, { username: "octocat" })
		await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, {
			provider: "github",
			scope: "octocat/repo1",
			webhookId: "11111",
		})
		await addSubscription(db, user.id, {
			provider: "github",
			scope: "octocat/repo2",
			webhookId: "22222",
		})
		await addSubscription(db, user.id, { provider: "jira", scope: "PROJ" })

		const delHook1 = mockGitHubDeleteWebhook()
		const delHook2 = mockGitHubDeleteWebhook()

		const result = await disconnectProvider(db, user.id, "github")

		expect(result.removed).toBe(true)
		expect(delHook1.isDone()).toBe(true)
		expect(delHook2.isDone()).toBe(true)

		const subs = await db
			.select()
			.from(subscriptionsTable)
			.where(eq(subscriptionsTable.userId, user.id))
		const gh = subs.filter((s) => s.provider === "github")
		const jira = subs.filter((s) => s.provider === "jira")
		expect(gh).toHaveLength(2)
		expect(gh.every((s) => s.isActive === false)).toBe(true)
		expect(jira).toHaveLength(1)
		expect(jira[0]!.isActive).toBe(true)

		const ghConn = await db
			.select()
			.from(connectionsTable)
			.where(and(eq(connectionsTable.userId, user.id), eq(connectionsTable.provider, "github")))
		const jiraConn = await db
			.select()
			.from(connectionsTable)
			.where(and(eq(connectionsTable.userId, user.id), eq(connectionsTable.provider, "jira")))
		expect(ghConn).toHaveLength(0)
		expect(jiraConn).toHaveLength(1)
	})

	it("deactivates only jira subscriptions and deletes only jira connection", async () => {
		const user = await createTestUser(db)
		await addGitHubConnection(db, user.id)
		await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, {
			provider: "github",
			scope: "u/r",
			webhookId: "33333",
		})
		await addSubscription(db, user.id, { provider: "jira", scope: "SCRUM" })

		const result = await disconnectProvider(db, user.id, "jira")

		expect(result.removed).toBe(true)
		const subs = await db
			.select()
			.from(subscriptionsTable)
			.where(eq(subscriptionsTable.userId, user.id))
		const gh = subs.filter((s) => s.provider === "github")
		const jira = subs.filter((s) => s.provider === "jira")
		expect(gh[0]!.isActive).toBe(true)
		expect(jira[0]!.isActive).toBe(false)

		const ghConn = await db
			.select()
			.from(connectionsTable)
			.where(and(eq(connectionsTable.userId, user.id), eq(connectionsTable.provider, "github")))
		const jiraConn = await db
			.select()
			.from(connectionsTable)
			.where(and(eq(connectionsTable.userId, user.id), eq(connectionsTable.provider, "jira")))
		expect(ghConn).toHaveLength(1)
		expect(jiraConn).toHaveLength(0)
	})

	it("still deactivates subscriptions and removes connection when github webhook deletion fails", async () => {
		const user = await createTestUser(db)
		await addGitHubConnection(db, user.id)
		await addSubscription(db, user.id, {
			provider: "github",
			scope: "u/broken-hook",
			webhookId: "44444",
		})

		// Simulate GitHub webhook removal failing (e.g. token revoked at provider).
		nock("https://api.github.com")
			.delete(/\/repos\/[^/]+\/[^/]+\/hooks\/.+/)
			.reply(404, {
				message: "Not Found",
			})

		const result = await disconnectProvider(db, user.id, "github")

		expect(result.removed).toBe(true)
		const subs = await db
			.select()
			.from(subscriptionsTable)
			.where(eq(subscriptionsTable.userId, user.id))
		expect(subs).toHaveLength(1)
		expect(subs[0]!.isActive).toBe(false)
		const conns = await db
			.select()
			.from(connectionsTable)
			.where(eq(connectionsTable.userId, user.id))
		expect(conns).toHaveLength(0)
	})

	it("no-op when connection does not exist (returns removed: false)", async () => {
		const user = await createTestUser(db)
		const result = await disconnectProvider(db, user.id, "github")
		expect(result.removed).toBe(false)
	})

	it("removes Jira webhook from Atlassian and clears local meta on jira disconnect", async () => {
		const user = await createTestUser(db)
		const conn = await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "DROP" })
		await seedJiraWebhookMeta(db, conn.id, {
			id: 4242,
			secret: "to-be-deleted",
			jql: 'project = "DROP"',
		})

		const delHook = mockJiraDeleteWebhook()
		const result = await disconnectProvider(db, user.id, "jira")

		expect(result.removed).toBe(true)
		expect(delHook.isDone()).toBe(true)
		const subs = await db
			.select()
			.from(subscriptionsTable)
			.where(eq(subscriptionsTable.userId, user.id))
		expect(subs[0]!.isActive).toBe(false)
		const conns = await db
			.select()
			.from(connectionsTable)
			.where(eq(connectionsTable.userId, user.id))
		expect(conns).toHaveLength(0)
	})
})
