import {
	createDatabase,
	events as eventsTable,
	subscriptions as subscriptionsTable,
} from "@devpinger/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { addSubscription, createTestUser, insertEvent } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

type NotificationsMod = typeof import("../../../worker/src/queues/notifications.js")
type RegistriesMod = typeof import("../../../worker/src/registries.js")

describe.skipIf(skip)("notification dispatch (worker processor)", () => {
	let db: ReturnType<typeof createDatabase>
	let handleNotificationJob: NotificationsMod["handleNotificationJob"]
	let destinationRegistry: RegistriesMod["destinationRegistry"]
	let deliverMock: ReturnType<typeof vi.fn>

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const mod = await import("../../../worker/src/queues/notifications.js")
		handleNotificationJob = mod.handleNotificationJob
		const reg = await import("../../../worker/src/registries.js")
		destinationRegistry = reg.destinationRegistry
	})

	beforeEach(() => {
		// Replace the real Telegram destination with a deterministic mock so the
		// processor flow can be tested without grammy's network stack.
		deliverMock = vi.fn().mockResolvedValue({ messageId: "4242", targetRef: "chat" })
		destinationRegistry.register({
			id: "telegram",
			displayName: "Telegram (test mock)",
			deliver: deliverMock,
			formatEvent: () => ({ text: "x", markup: undefined }),
		})
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("delivers a pending event to Telegram and marks it delivered", async () => {
		const tgChatId = 666_001
		const user = await createTestUser(db, {
			telegramId: tgChatId,
			telegramChatId: tgChatId,
			telegramUsername: "deliveryuser",
		})
		const event = await insertEvent(db, user.id, {
			type: "pull_request.opened",
			scope: "deliveryuser/repo",
			title: "deliveryuser/repo #1: Add feature",
			url: "https://github.com/deliveryuser/repo/pull/1",
			metadata: { prNumber: 1, number: 1 },
		})

		await handleNotificationJob({
			eventId: event.id,
			userId: user.id,
			telegramChatId: tgChatId,
			lang: "en",
		})

		expect(deliverMock).toHaveBeenCalledTimes(1)
		const callArg = deliverMock.mock.calls[0]![0] as {
			user: { id: string; preferences: { telegramChatId: number } }
			event: { sourceEventId: string; type: string }
		}
		expect(callArg.user.id).toBe(user.id)
		expect(callArg.user.preferences.telegramChatId).toBe(tgChatId)
		expect(callArg.event.type).toBe("pull_request.opened")

		const [updated] = await db
			.select()
			.from(eventsTable)
			.where(eq(eventsTable.id, event.id))
			.limit(1)
		expect(updated).toBeDefined()
		expect(updated!.status).toBe("delivered")
		expect(updated!.telegramMessageId).toBe(4242)
		expect(updated!.deliveredAt).toBeTruthy()
	})

	it("skips delivery for an event already marked delivered (idempotency)", async () => {
		const tgChatId = 666_002
		const user = await createTestUser(db, {
			telegramId: tgChatId,
			telegramChatId: tgChatId,
			telegramUsername: "idempotent",
		})
		const event = await insertEvent(db, user.id, {
			status: "delivered",
			telegramMessageId: 100,
			scope: "idempotent/repo",
			metadata: { prNumber: 2, number: 2 },
		})

		await handleNotificationJob({
			eventId: event.id,
			userId: user.id,
			telegramChatId: tgChatId,
			lang: "en",
		})

		// Processor should short-circuit on `already-delivered`.
		expect(deliverMock).not.toHaveBeenCalled()
		const [unchanged] = await db
			.select()
			.from(eventsTable)
			.where(eq(eventsTable.id, event.id))
			.limit(1)
		expect(unchanged!.telegramMessageId).toBe(100)
	})

	it("on Telegram 403, deactivates all user subscriptions and marks event failed", async () => {
		const tgChatId = 666_004
		const user = await createTestUser(db, {
			telegramId: tgChatId,
			telegramChatId: tgChatId,
			telegramUsername: "blockedbot",
		})
		await addSubscription(db, user.id, { provider: "github", scope: "blockedbot/a" })
		await addSubscription(db, user.id, { provider: "github", scope: "blockedbot/b" })
		const event = await insertEvent(db, user.id, {
			scope: "blockedbot/a",
			metadata: { prNumber: 4, number: 4 },
		})

		const forbidden = Object.assign(new Error("Forbidden: bot was blocked by the user"), {
			name: "GrammyError",
			error_code: 403,
			description: "Forbidden: bot was blocked by the user",
			method: "sendMessage",
		})
		deliverMock.mockRejectedValueOnce(forbidden)

		await expect(
			handleNotificationJob({
				eventId: event.id,
				userId: user.id,
				telegramChatId: tgChatId,
				lang: "en",
			}),
		).resolves.toBeUndefined()

		const subs = await db
			.select()
			.from(subscriptionsTable)
			.where(eq(subscriptionsTable.userId, user.id))
		expect(subs.length).toBeGreaterThanOrEqual(2)
		for (const s of subs) expect(s.isActive).toBe(false)

		const [updated] = await db
			.select()
			.from(eventsTable)
			.where(and(eq(eventsTable.id, event.id), eq(eventsTable.userId, user.id)))
			.limit(1)
		expect(updated!.status).toBe("failed")
	})

	it("skips delivery for a muted event", async () => {
		const tgChatId = 666_003
		const user = await createTestUser(db, {
			telegramId: tgChatId,
			telegramChatId: tgChatId,
			telegramUsername: "muted",
		})
		const event = await insertEvent(db, user.id, {
			status: "muted",
			scope: "muted/repo",
			metadata: { prNumber: 3, number: 3 },
		})

		await handleNotificationJob({
			eventId: event.id,
			userId: user.id,
			telegramChatId: tgChatId,
			lang: "en",
		})

		expect(deliverMock).not.toHaveBeenCalled()
		const [stillMuted] = await db
			.select()
			.from(eventsTable)
			.where(eq(eventsTable.id, event.id))
			.limit(1)
		expect(stillMuted!.status).toBe("muted")
		expect(stillMuted!.telegramMessageId).toBeNull()
	})
})
