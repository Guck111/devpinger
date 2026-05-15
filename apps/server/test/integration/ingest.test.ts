import { createHmac } from "node:crypto"
import { createCipher } from "@devpinger/crypto"
import {
	connections as connectionsTable,
	createDatabase,
	events as eventsTable,
	subscriptions as subscriptionsTable,
	users as usersTable,
} from "@devpinger/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("ingestWebhook GitHub pipeline", () => {
	let db: ReturnType<typeof createDatabase>
	let ingestWebhook: typeof import("../../src/services/ingest.js").ingestWebhook
	let sourceRegistry: typeof import("../../src/registries.js").sourceRegistry
	let notificationsQueue: typeof import("../../src/queues.js").notificationsQueue
	let redisConnection: typeof import("../../src/queues.js").redisConnection

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const services = await import("../../src/services/ingest.js")
		ingestWebhook = services.ingestWebhook
		const reg = await import("../../src/registries.js")
		sourceRegistry = reg.sourceRegistry
		const queues = await import("../../src/queues.js")
		notificationsQueue = queues.notificationsQueue
		redisConnection = queues.redisConnection
	})

	afterAll(async () => {
		await notificationsQueue?.close()
		await redisConnection?.quit().catch(() => undefined)
		await db.$client.end({ timeout: 5 })
	})

	it("persists an event and enqueues a delivery job for a valid PR opened webhook", async () => {
		const cipher = createCipher("0".repeat(64))

		const [user] = await db
			.insert(usersTable)
			.values({
				telegramId: 100100100,
				telegramChatId: 100100100,
				telegramUsername: "viewer",
				lang: "en",
			})
			.returning()
		expect(user).toBeDefined()
		const userId = user!.id

		await db.insert(connectionsTable).values({
			userId,
			provider: "github",
			providerUserId: "7",
			providerUsername: "viewer",
			encryptedCredentials: cipher.encrypt(
				JSON.stringify({ accessToken: "ghp_testtoken", scopes: ["repo"] }),
			),
		})

		const webhookSecret = "test-github-webhook-secret"
		const [subscription] = await db
			.insert(subscriptionsTable)
			.values({
				userId,
				provider: "github",
				providerScopeId: "viewer/repo",
				displayName: "viewer/repo",
				webhookId: "12345",
				webhookSecret,
				isActive: true,
			})
			.returning()
		expect(subscription).toBeDefined()

		const payload = {
			action: "opened",
			number: 42,
			pull_request: {
				number: 42,
				title: "Add cool feature",
				body: "This PR adds a cool feature.",
				html_url: "https://github.com/viewer/repo/pull/42",
				draft: false,
				additions: 10,
				deletions: 2,
				changed_files: 3,
			},
			repository: {
				id: 1,
				name: "repo",
				full_name: "viewer/repo",
				html_url: "https://github.com/viewer/repo",
			},
			sender: {
				id: 99,
				login: "otheruser",
				type: "User",
				avatar_url: "https://github.com/otheruser.png",
			},
		}
		const rawBody = JSON.stringify(payload)
		const signature = `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`

		const adapter = sourceRegistry.require("github")
		const result = await ingestWebhook(db, {
			provider: "github",
			adapter,
			headers: {
				"x-github-event": "pull_request",
				"x-github-delivery": "delivery-1",
				"x-hub-signature-256": signature,
				"content-type": "application/json",
			},
			rawBody,
			parsedBody: payload,
		})

		expect(result).toHaveLength(1)
		const eventId = result[0]!.eventId
		expect(result[0]!.muted).toBe(false)

		const [persisted] = await db
			.select()
			.from(eventsTable)
			.where(and(eq(eventsTable.id, eventId), eq(eventsTable.userId, userId)))
			.limit(1)
		expect(persisted).toBeDefined()
		expect(persisted!.source).toBe("github")
		expect(persisted!.type).toBe("pull_request.opened")
		expect(persisted!.title).toContain("#42")
		expect(persisted!.scope).toBe("viewer/repo")

		const job = await notificationsQueue.getJob(`deliver-${eventId}`)
		expect(job).toBeDefined()
		expect(job?.data).toMatchObject({
			eventId,
			userId,
			telegramChatId: 100100100,
			lang: "en",
		})
	})

	it("drops a webhook with an invalid signature", async () => {
		const [user] = await db
			.insert(usersTable)
			.values({
				telegramId: 200200200,
				telegramChatId: 200200200,
				telegramUsername: "viewer2",
				lang: "en",
			})
			.returning()
		const userId = user!.id

		const cipher = createCipher("0".repeat(64))
		await db.insert(connectionsTable).values({
			userId,
			provider: "github",
			providerUserId: "8",
			providerUsername: "viewer2",
			encryptedCredentials: cipher.encrypt(JSON.stringify({ accessToken: "x" })),
		})

		await db.insert(subscriptionsTable).values({
			userId,
			provider: "github",
			providerScopeId: "viewer2/other",
			displayName: "viewer2/other",
			webhookSecret: "right-secret",
			isActive: true,
		})

		const payload = { action: "opened", pull_request: { number: 1 } }
		const rawBody = JSON.stringify(payload)

		const adapter = sourceRegistry.require("github")
		const result = await ingestWebhook(db, {
			provider: "github",
			adapter,
			headers: {
				"x-github-event": "pull_request",
				"x-github-delivery": "delivery-bad",
				"x-hub-signature-256": "sha256=00",
				"content-type": "application/json",
			},
			rawBody,
			parsedBody: payload,
		})
		expect(result).toHaveLength(0)
	})
})
