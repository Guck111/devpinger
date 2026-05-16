import { createDatabase } from "@devpinger/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mockGitHubIssueComment } from "./helpers/nock-helpers.js"
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

describe.skipIf(skip)("Action: Comment via bot callback + pending-state submit", () => {
	let db: ReturnType<typeof createDatabase>
	let handleComment: typeof import("../../src/bot/actions.js").handleComment
	let submitPendingComment: typeof import("../../src/bot/actions.js").submitPendingComment
	let getPendingAction: typeof import("../../src/services/pending-action.js").getPendingAction
	let setPendingAction: typeof import("../../src/services/pending-action.js").setPendingAction
	let clearPendingAction: typeof import("../../src/services/pending-action.js").clearPendingAction
	let redisConnection: typeof import("../../src/queues.js").redisConnection

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const actions = await import("../../src/bot/actions.js")
		handleComment = actions.handleComment
		submitPendingComment = actions.submitPendingComment
		const pending = await import("../../src/services/pending-action.js")
		getPendingAction = pending.getPendingAction
		setPendingAction = pending.setPendingAction
		clearPendingAction = pending.clearPendingAction
		const queues = await import("../../src/queues.js")
		redisConnection = queues.redisConnection
	})

	afterAll(async () => {
		await redisConnection?.quit().catch(() => undefined)
		await db.$client.end({ timeout: 5 })
	})

	it("handleComment sets a pending comment action in Redis", async () => {
		const telegramId = 720_001
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			scope: "commenter/sample",
			metadata: { prNumber: 5, number: 5 },
		})

		// Ensure no leftover pending state.
		await clearPendingAction(redisConnection, telegramId)

		const ctx = makeCtx(telegramId)
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await handleComment(ctx as any, event.id)

		const pending = await getPendingAction(redisConnection, telegramId)
		expect(pending).not.toBeNull()
		expect(pending?.kind).toBe("comment")
		expect(pending?.eventId).toBe(event.id)
		expect(pending?.expiresAt).toBeGreaterThan(Date.now())
		expect(ctx.answerCallbackQuery).toHaveBeenCalled()
		expect(ctx.reply).toHaveBeenCalled()
	})

	it("submitPendingComment posts the body to GitHub and replies confirmation", async () => {
		const telegramId = 720_002
		const user = await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})
		await addGitHubConnection(db, user.id)
		const event = await insertEvent(db, user.id, {
			scope: "commenter/sample",
			metadata: { prNumber: 6, number: 6 },
		})

		// Simulate prior pending state (as if handleComment was just called).
		await setPendingAction(redisConnection, telegramId, {
			kind: "comment",
			eventId: event.id,
			expiresAt: Date.now() + 60_000,
		})

		const ghComment = mockGitHubIssueComment()

		const fakeCtx = {
			from: { id: telegramId },
			t: (key: string) => key,
			reply: vi.fn().mockResolvedValue(undefined),
		}
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await submitPendingComment(fakeCtx as any, event.id, "LGTM, shipping it")

		expect(ghComment.isDone()).toBe(true)
		expect(fakeCtx.reply).toHaveBeenCalled()
	})

	it("clearing pending state prevents subsequent text from being treated as a comment", async () => {
		const telegramId = 720_003
		await createTestUser(db, {
			telegramId,
			telegramChatId: telegramId,
		})

		await setPendingAction(redisConnection, telegramId, {
			kind: "comment",
			eventId: "00000000-0000-0000-0000-000000000000",
			expiresAt: Date.now() + 60_000,
		})

		await clearPendingAction(redisConnection, telegramId)

		const pending = await getPendingAction(redisConnection, telegramId)
		expect(pending).toBeNull()
	})

	it("submitPendingComment replies notFound when event does not belong to user", async () => {
		const ownerId = 720_004
		const intruderId = 720_005
		const owner = await createTestUser(db, {
			telegramId: ownerId,
			telegramChatId: ownerId,
		})
		const event = await insertEvent(db, owner.id, {
			scope: "owner/repo",
			metadata: { prNumber: 1, number: 1 },
		})
		await createTestUser(db, { telegramId: intruderId, telegramChatId: intruderId })

		const fakeCtx = {
			from: { id: intruderId },
			t: (key: string) => key,
			reply: vi.fn().mockResolvedValue(undefined),
		}
		// biome-ignore lint/suspicious/noExplicitAny: mock context shape
		await submitPendingComment(fakeCtx as any, event.id, "hello")

		expect(fakeCtx.reply).toHaveBeenCalled()
		const replyText = fakeCtx.reply.mock.calls[0]![0] as string
		expect(replyText).toContain("notFound")
	})
})
