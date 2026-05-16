import {
	connections as connectionsTable,
	createDatabase,
	events as eventsTable,
	mutes as mutesTable,
	subscriptions as subscriptionsTable,
	users as usersTable,
} from "@devpinger/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
	addGitHubConnection,
	addSubscription,
	createTestUser,
	insertEvent,
} from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

interface MockCallbackContext {
	from: { id: number }
	answerCallbackQuery: ReturnType<typeof vi.fn>
	editMessageText: ReturnType<typeof vi.fn>
	deleteMessage: ReturnType<typeof vi.fn>
}

const makeCtx = (telegramId: number): MockCallbackContext => ({
	from: { id: telegramId },
	answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
	editMessageText: vi.fn().mockResolvedValue(undefined),
	deleteMessage: vi.fn().mockResolvedValue(undefined),
})

describe.skipIf(skip)("/unsubscribe cascade via bot callback", () => {
	let db: ReturnType<typeof createDatabase>
	let handleDeleteConfirm: typeof import("../../src/bot/account.js").handleDeleteConfirm
	let handleDeleteCancel: typeof import("../../src/bot/account.js").handleDeleteCancel

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const account = await import("../../src/bot/account.js")
		handleDeleteConfirm = account.handleDeleteConfirm
		handleDeleteCancel = account.handleDeleteCancel
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("confirm callback cascades and removes user + connections + subscriptions + events + mutes", async () => {
		const telegramId = 730_001
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
			telegramUsername: "todelete",
		})
		await addGitHubConnection(db, user.id)
		const sub = await addSubscription(db, user.id, { scope: "todelete/repo" })
		await insertEvent(db, user.id, { scope: "todelete/repo", metadata: { prNumber: 1, number: 1 } })
		await insertEvent(db, user.id, { scope: "todelete/repo", metadata: { prNumber: 2, number: 2 } })
		await db.insert(mutesTable).values({
			userId: user.id,
			scopeType: "repo",
			scopeValue: "todelete/repo",
		})

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleDeleteConfirm(ctx as any)

		expect(ctx.answerCallbackQuery).toHaveBeenCalled()

		const [u, c, s, e, m] = await Promise.all([
			db.select().from(usersTable).where(eq(usersTable.id, user.id)),
			db.select().from(connectionsTable).where(eq(connectionsTable.userId, user.id)),
			db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id)),
			db.select().from(eventsTable).where(eq(eventsTable.userId, user.id)),
			db.select().from(mutesTable).where(eq(mutesTable.userId, user.id)),
		])
		expect(u).toHaveLength(0)
		expect(c).toHaveLength(0)
		expect(s).toHaveLength(0)
		expect(e).toHaveLength(0)
		expect(m).toHaveLength(0)
		// Use sub to silence unused-var.
		expect(sub.userId).toBe(user.id)
	})

	it("cancel callback preserves the account (no DB writes)", async () => {
		const telegramId = 730_002
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
			telegramUsername: "keepme",
		})
		await addGitHubConnection(db, user.id)
		await addSubscription(db, user.id, { scope: "keepme/repo" })

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleDeleteCancel(ctx as any)

		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		const cbArg = ctx.answerCallbackQuery.mock.calls[0]![0] as { text?: string } | undefined
		expect(cbArg?.text).toContain("Cancelled")

		const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, user.id))
		expect(stillThere).toBeDefined()
		const conns = await db
			.select()
			.from(connectionsTable)
			.where(eq(connectionsTable.userId, user.id))
		expect(conns).toHaveLength(1)
	})

	it("confirm on an already-deleted user is idempotent (no crash)", async () => {
		const telegramId = 730_003
		// Do NOT create the user — handler should gracefully no-op.
		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleDeleteConfirm(ctx as any)

		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		const cbArg = ctx.answerCallbackQuery.mock.calls[0]![0] as { text?: string } | undefined
		expect(cbArg?.text).toContain("Already deleted")
	})
})
