import { createDatabase, subscriptions as subscriptionsTable } from "@devpinger/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mockGitHubCreateWebhook } from "./helpers/nock-helpers.js"
import { addGitHubConnection, createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

interface MockCallbackContext {
	from: { id: number }
	t: (key: string, params?: Record<string, unknown>) => string
	answerCallbackQuery: ReturnType<typeof vi.fn>
	editMessageReplyMarkup: ReturnType<typeof vi.fn>
	callbackQuery: { message?: { reply_markup?: unknown } }
}

const makeCtx = (telegramId: number, replyMarkup?: unknown): MockCallbackContext => ({
	from: { id: telegramId },
	t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
	answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
	editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
	callbackQuery: { message: replyMarkup ? { reply_markup: replyMarkup } : undefined },
})

describe.skipIf(skip)("/repos add: registers GitHub webhook and creates subscription", () => {
	let db: ReturnType<typeof createDatabase>
	let handleRepoAdd: typeof import("../../src/bot/repos.js").handleRepoAdd

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const repos = await import("../../src/bot/repos.js")
		handleRepoAdd = repos.handleRepoAdd
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("creates an active subscription with webhookId on `repo:add:owner/repo` callback", async () => {
		const telegramId = 555_001
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
			telegramUsername: "repoadder",
		})
		await addGitHubConnection(db, user.id, { username: "repoadder" })

		const createHook = mockGitHubCreateWebhook(123456)

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleRepoAdd(ctx as any, "repoadder/sample")

		expect(createHook.isDone()).toBe(true)
		expect(ctx.answerCallbackQuery).toHaveBeenCalled()

		const subs = await db
			.select()
			.from(subscriptionsTable)
			.where(eq(subscriptionsTable.userId, user.id))
		expect(subs).toHaveLength(1)
		const sub = subs[0]!
		expect(sub.provider).toBe("github")
		expect(sub.providerScopeId).toBe("repoadder/sample")
		expect(sub.displayName).toBe("repoadder/sample")
		expect(sub.webhookId).toBe("123456")
		expect(sub.isActive).toBe(true)
		expect(sub.webhookSecret).toBeTruthy()
	})

	it("answers callback gracefully when user has no GitHub connection", async () => {
		const telegramId = 555_002
		await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
			telegramUsername: "noconn",
		})

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleRepoAdd(ctx as any, "noconn/sample")

		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		// Should have called with an error text (unauthorized key).
		const calls = ctx.answerCallbackQuery.mock.calls
		expect(calls.length).toBeGreaterThan(0)
		const lastCallArg = calls[0]![0] as { text?: string } | undefined
		expect(lastCallArg?.text).toContain("unauthorized")
	})
})
