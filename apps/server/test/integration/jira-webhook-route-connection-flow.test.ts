import { createCipher } from "@devpinger/crypto"
import {
	connections as connectionsTable,
	createDatabase,
	events as eventsTable,
} from "@devpinger/db"
import { and, eq, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { addJiraConnection, addSubscription, createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

const cipher = createCipher("0".repeat(64))

const jiraPayload = (projectKey: string) => ({
	webhookEvent: "comment_created",
	timestamp: Date.now(),
	user: { accountId: "actor-x", displayName: "Outside Actor" },
	issue: {
		id: "10001",
		key: `${projectKey}-1`,
		self: `https://test.atlassian.net/rest/api/3/issue/${projectKey}-1`,
		fields: {
			summary: "Test",
			project: { id: "10000", key: projectKey, name: "Project" },
		},
	},
	comment: {
		id: "20001",
		author: { accountId: "actor-x", displayName: "Outside Actor" },
		body: "hello",
	},
})

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
	const creds = JSON.parse(cipher.decrypt(row.encryptedCredentials)) as Record<string, unknown>
	const next = {
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

describe.skipIf(skip)("Jira webhook route: connection-id flow", () => {
	let db: ReturnType<typeof createDatabase>
	let app: FastifyInstance
	let notificationsQueue: typeof import("../../src/queues.js").notificationsQueue
	let redisConnection: typeof import("../../src/queues.js").redisConnection

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const serverModule = await import("../../src/server.js")
		app = await serverModule.createApp()
		const queues = await import("../../src/queues.js")
		notificationsQueue = queues.notificationsQueue
		redisConnection = queues.redisConnection
	})

	afterAll(async () => {
		await app.close()
		await notificationsQueue?.close()
		await redisConnection?.quit().catch(() => undefined)
		await db.$client.end({ timeout: 5 })
	})

	it("accepts POST when URL has connectionId, matches subscription by project key", async () => {
		const user = await createTestUser(db)
		const conn = await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "ROUTE1" })
		await seedJiraWebhookMeta(db, conn.id, {
			id: 5555,
			secret: "conn-flow-secret",
			jql: 'project = "ROUTE1"',
		})

		const res = await app.inject({
			method: "POST",
			url: `/webhooks/jira/${conn.id}?secret=conn-flow-secret`,
			headers: { "content-type": "application/json" },
			payload: jiraPayload("ROUTE1"),
		})

		expect(res.statusCode).toBe(200)
		const events = await db
			.select()
			.from(eventsTable)
			.where(and(eq(eventsTable.userId, user.id), eq(eventsTable.scope, "ROUTE1")))
		expect(events.length).toBeGreaterThanOrEqual(1)
	})

	it("returns 401 on wrong secret in connection flow", async () => {
		const user = await createTestUser(db)
		const conn = await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "ROUTE2" })
		await seedJiraWebhookMeta(db, conn.id, {
			id: 6666,
			secret: "right-secret",
			jql: 'project = "ROUTE2"',
		})

		const res = await app.inject({
			method: "POST",
			url: `/webhooks/jira/${conn.id}?secret=wrong-secret`,
			headers: { "content-type": "application/json" },
			payload: jiraPayload("ROUTE2"),
		})

		expect(res.statusCode).toBe(401)
	})

	it("returns 200 with accepted=0 when payload project not in active subscriptions", async () => {
		const user = await createTestUser(db)
		const conn = await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "WATCHED" })
		await seedJiraWebhookMeta(db, conn.id, {
			id: 7777,
			secret: "secret-x",
			jql: 'project = "WATCHED"',
		})

		// Payload arrives for a project the user doesn't watch (JQL desync).
		const res = await app.inject({
			method: "POST",
			url: `/webhooks/jira/${conn.id}?secret=secret-x`,
			headers: { "content-type": "application/json" },
			payload: jiraPayload("OTHER"),
		})

		expect(res.statusCode).toBe(200)
		expect(res.json()).toMatchObject({ accepted: 0 })
		const events = await db
			.select()
			.from(eventsTable)
			.where(and(eq(eventsTable.userId, user.id), eq(eventsTable.scope, "OTHER")))
		expect(events).toHaveLength(0)
	})
})
