import { createDatabase, events as eventsTable } from "@devpinger/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mockGitHubPRReview } from "./helpers/nock-helpers.js"
import { addGitHubConnection, createTestUser, insertEvent } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

interface MockCallbackContext {
	from: { id: number }
	t: (key: string, params?: Record<string, unknown>) => string
	answerCallbackQuery: ReturnType<typeof vi.fn>
	reply: ReturnType<typeof vi.fn>
}

const makeCtx = (telegramId: number): MockCallbackContext => ({
	from: { id: telegramId },
	t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
	answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
	reply: vi.fn().mockResolvedValue(undefined),
})

describe.skipIf(skip)("Action: Approve PR via bot callback", () => {
	let db: ReturnType<typeof createDatabase>
	let handleApprove: typeof import("../../src/bot/actions.js").handleApprove

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const actions = await import("../../src/bot/actions.js")
		handleApprove = actions.handleApprove
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("calls GitHub Reviews API and marks event completed", async () => {
		const telegramId = 700_001
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			scope: "approver/sample",
			metadata: { prNumber: 42, number: 42 },
			url: "https://github.com/approver/sample/pull/42",
		})

		const ghReview = mockGitHubPRReview("APPROVED")

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleApprove(ctx as any, event.id)

		expect(ghReview.isDone()).toBe(true)
		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		expect(ctx.reply).toHaveBeenCalled()

		const [updated] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id))
		expect(updated!.status).toBe("completed")
		expect(updated!.completedAt).toBeTruthy()
	})

	it("is idempotent: a second approve on an already-completed event does NOT hit GitHub", async () => {
		const telegramId = 700_002
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			status: "completed",
			scope: "approver/sample",
			metadata: { prNumber: 7, number: 7 },
		})

		// No GitHub mock — if handler tries to call, nock blocks and surfaces error.
		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleApprove(ctx as any, event.id)

		// Should answer with "alreadyDone" via replyError, NOT call GitHub.
		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		const cbArg = ctx.answerCallbackQuery.mock.calls[0]![0] as { text?: string } | undefined
		expect(cbArg?.text).toContain("alreadyDone")
	})

	it("answers 'notFound' when event does not belong to user", async () => {
		const ownerTgId = 700_003
		const intruderTgId = 700_004
		const owner = await createTestUser(db, {
			telegramId: ownerTgId,
			telegramChatId: ownerTgId,
		})
		await addGitHubConnection(db, owner.id)
		const event = await insertEvent(db, owner.id, {
			scope: "owner/repo",
			metadata: { prNumber: 99, number: 99 },
		})

		await createTestUser(db, { telegramId: intruderTgId, telegramChatId: intruderTgId })

		const ctx = makeCtx(intruderTgId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleApprove(ctx as any, event.id)

		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		const cbArg = ctx.answerCallbackQuery.mock.calls[0]![0] as { text?: string } | undefined
		expect(cbArg?.text).toContain("notFound")
	})

	it("gracefully handles 404 from GitHub (deleted PR)", async () => {
		const telegramId = 700_005
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			scope: "approver/gone",
			metadata: { prNumber: 404, number: 404 },
		})

		// Mock GitHub to return 404 (PR not found).
		const nock404 = await import("nock")
		nock404
			.default("https://api.github.com")
			.post(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews/)
			.reply(404, { message: "Not Found" })

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleApprove(ctx as any, event.id)

		// Should answer with notFound error; event NOT marked completed.
		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		const [unchanged] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id))
		expect(unchanged!.status).not.toBe("completed")
	})
})
