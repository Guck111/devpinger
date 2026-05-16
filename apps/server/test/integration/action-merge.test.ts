import { createDatabase, events as eventsTable } from "@devpinger/db"
import { eq } from "drizzle-orm"
import nock from "nock"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mockGitHubPRMerge } from "./helpers/nock-helpers.js"
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

describe.skipIf(skip)("Action: Merge PR via bot callback", () => {
	let db: ReturnType<typeof createDatabase>
	let handleMerge: typeof import("../../src/bot/actions.js").handleMerge

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const actions = await import("../../src/bot/actions.js")
		handleMerge = actions.handleMerge
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("merges a mergeable PR and marks event completed", async () => {
		const telegramId = 710_001
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			scope: "merger/sample",
			metadata: { prNumber: 42, number: 42 },
		})

		const ghMerge = mockGitHubPRMerge({ merged: true })

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleMerge(ctx as any, event.id)

		expect(ghMerge.isDone()).toBe(true)
		expect(ctx.reply).toHaveBeenCalled()

		const [updated] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id))
		expect(updated!.status).toBe("completed")
		expect(updated!.completedAt).toBeTruthy()
	})

	it("replies gracefully and keeps event NOT completed on unmergeable (405)", async () => {
		const telegramId = 710_002
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			scope: "merger/conflicted",
			metadata: { prNumber: 13, number: 13 },
		})

		// 405 from PUT /merge — Pull Request is not mergeable.
		mockGitHubPRMerge({ merged: false, status: 405 })

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleMerge(ctx as any, event.id)

		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		const [unchanged] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id))
		expect(unchanged!.status).not.toBe("completed")
	})

	it("replies gracefully on 404 (deleted PR) and keeps event NOT completed", async () => {
		const telegramId = 710_003
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			scope: "merger/gone",
			metadata: { prNumber: 404, number: 404 },
		})

		// Persist so any internal Octokit retry hits a 404 (not "no match") and
		// the handler can classify the error as a notFound.
		nock("https://api.github.com")
			.put(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge/)
			.times(5)
			.reply(404, { message: "Not Found" })

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleMerge(ctx as any, event.id)

		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		const cbArg = ctx.answerCallbackQuery.mock.calls[0]![0] as { text?: string } | undefined
		expect(cbArg?.text).toContain("notFound")
		const [unchanged] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id))
		expect(unchanged!.status).not.toBe("completed")
	})

	it("short-circuits when event already completed (idempotency)", async () => {
		const telegramId = 710_004
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			status: "completed",
			scope: "merger/done",
			metadata: { prNumber: 1, number: 1 },
		})

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleMerge(ctx as any, event.id)

		const cbArg = ctx.answerCallbackQuery.mock.calls[0]![0] as { text?: string } | undefined
		expect(cbArg?.text).toContain("alreadyDone")
	})
})
