import {
	createDatabase,
	events as eventsTable,
	subscriptions as subscriptionsTable,
} from "@devpinger/db"
import { and, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { addJiraConnection, addSubscription, createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

const jiraPayload = (issueKey: string, projectKey: string) => ({
	webhookEvent: "comment_created",
	timestamp: Date.now(),
	user: {
		accountId: "actor-123",
		displayName: "Outside Actor",
	},
	issue: {
		id: "10001",
		key: issueKey,
		self: `https://test.atlassian.net/rest/api/3/issue/${issueKey}`,
		fields: {
			summary: "Test issue",
			project: { id: "10000", key: projectKey, name: "Project" },
		},
	},
	comment: {
		id: "20001",
		author: { accountId: "actor-123", displayName: "Outside Actor" },
		body: "hello",
	},
})

describe.skipIf(skip)("Jira webhook signature verification", () => {
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

	it("accepts POST with the correct secret", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id, { cloudId: "cloud-1" })
		const sub = await addSubscription(db, user.id, {
			provider: "jira",
			scope: "PROJ1",
			webhookSecret: "right-secret",
		})

		const res = await app.inject({
			method: "POST",
			url: `/webhooks/jira/${sub.id}?secret=right-secret`,
			headers: { "content-type": "application/json" },
			payload: jiraPayload("PROJ1-1", "PROJ1"),
		})

		expect(res.statusCode).toBe(200)
		expect(res.json()).toMatchObject({ accepted: expect.any(Number) })

		const rows = await db
			.select()
			.from(eventsTable)
			.where(and(eq(eventsTable.userId, user.id), eq(eventsTable.scope, "PROJ1")))
		expect(rows.length).toBeGreaterThanOrEqual(1)
	})

	it("rejects POST with the wrong secret", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id, { cloudId: "cloud-2" })
		const sub = await addSubscription(db, user.id, {
			provider: "jira",
			scope: "PROJ2",
			webhookSecret: "real-secret",
		})

		const res = await app.inject({
			method: "POST",
			url: `/webhooks/jira/${sub.id}?secret=wrong`,
			headers: { "content-type": "application/json" },
			payload: jiraPayload("PROJ2-1", "PROJ2"),
		})

		expect(res.statusCode).toBe(401)
		expect(res.json()).toMatchObject({ error: "invalid secret" })

		const rows = await db
			.select()
			.from(eventsTable)
			.where(and(eq(eventsTable.userId, user.id), eq(eventsTable.scope, "PROJ2")))
		expect(rows).toHaveLength(0)
	})

	it("rejects POST with no secret", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id, { cloudId: "cloud-3" })
		const sub = await addSubscription(db, user.id, {
			provider: "jira",
			scope: "PROJ3",
			webhookSecret: "stored-secret",
		})

		const res = await app.inject({
			method: "POST",
			url: `/webhooks/jira/${sub.id}`,
			headers: { "content-type": "application/json" },
			payload: jiraPayload("PROJ3-1", "PROJ3"),
		})

		expect(res.statusCode).toBe(401)
	})

	it("returns 404 for unknown subscriptionId", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/webhooks/jira/00000000-0000-0000-0000-000000000000?secret=anything",
			headers: { "content-type": "application/json" },
			payload: jiraPayload("UNK-1", "UNK"),
		})

		expect(res.statusCode).toBe(404)
	})

	it("returns 404 for a deactivated subscription", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id, { cloudId: "cloud-4" })
		const sub = await addSubscription(db, user.id, {
			provider: "jira",
			scope: "PROJ4",
			webhookSecret: "stored-secret",
		})
		await db
			.update(subscriptionsTable)
			.set({ isActive: false })
			.where(eq(subscriptionsTable.id, sub.id))

		const res = await app.inject({
			method: "POST",
			url: `/webhooks/jira/${sub.id}?secret=stored-secret`,
			headers: { "content-type": "application/json" },
			payload: jiraPayload("PROJ4-1", "PROJ4"),
		})

		expect(res.statusCode).toBe(404)
	})
})
