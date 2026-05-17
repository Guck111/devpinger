import { createCipher } from "@devpinger/crypto"
import {
	type ConnectionCredentialsPayload,
	connections as connectionsTable,
	createDatabase,
	subscriptions as subscriptionsTable,
} from "@devpinger/db"
import { and, eq } from "drizzle-orm"
import nock from "nock"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	mockJiraCreateWebhook,
	mockJiraCreateWebhookForbidden,
	mockJiraDeleteWebhook,
} from "./helpers/nock-helpers.js"
import { addJiraConnection, addSubscription, createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

const cipher = createCipher("0".repeat(64))

const readJiraCreds = async (
	db: ReturnType<typeof createDatabase>,
	userId: string,
): Promise<ConnectionCredentialsPayload | null> => {
	const [row] = await db
		.select()
		.from(connectionsTable)
		.where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.provider, "jira")))
		.limit(1)
	if (!row) return null
	return JSON.parse(cipher.decrypt(row.encryptedCredentials)) as ConnectionCredentialsPayload
}

describe.skipIf(skip)("Jira webhook automation: ensureJiraWebhook", () => {
	let db: ReturnType<typeof createDatabase>
	let ensureJiraWebhook: typeof import("../../src/services/jira-webhooks.js").ensureJiraWebhook
	let removeJiraWebhook: typeof import("../../src/services/jira-webhooks.js").removeJiraWebhook

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const svc = await import("../../src/services/jira-webhooks.js")
		ensureJiraWebhook = svc.ensureJiraWebhook
		removeJiraWebhook = svc.removeJiraWebhook
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("creates the webhook on first project, persists meta to credentials", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "SCRUM" })

		const createHook = mockJiraCreateWebhook(7777)
		const res = await ensureJiraWebhook(db, user.id)
		expect(res.status).toBe("created")
		expect(createHook.isDone()).toBe(true)

		const creds = await readJiraCreds(db, user.id)
		expect(creds?.jiraWebhook?.id).toBe(7777)
		expect(creds?.jiraWebhook?.jql).toBe('project = "SCRUM"')
		expect(creds?.jiraWebhook?.secret).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it("deletes old + creates new when JQL changes (project added)", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "A" })

		mockJiraCreateWebhook(1)
		await ensureJiraWebhook(db, user.id)

		await addSubscription(db, user.id, { provider: "jira", scope: "B" })
		const delHook = mockJiraDeleteWebhook()
		const createHook = mockJiraCreateWebhook(2)
		const res = await ensureJiraWebhook(db, user.id)

		expect(res.status).toBe("recreated")
		expect(delHook.isDone()).toBe(true)
		expect(createHook.isDone()).toBe(true)

		const creds = await readJiraCreds(db, user.id)
		expect(creds?.jiraWebhook?.id).toBe(2)
		expect(creds?.jiraWebhook?.jql).toBe('project IN ("A","B")')
	})

	it("does nothing when JQL unchanged (re-add same project)", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "SCRUM" })

		mockJiraCreateWebhook(100)
		await ensureJiraWebhook(db, user.id)

		// No new nock interceptors registered — if ensureJiraWebhook
		// erroneously called Jira, nock would throw "No match for request".
		const res = await ensureJiraWebhook(db, user.id)
		expect(res.status).toBe("unchanged")
	})

	it("flags needsReconnect on 403 (missing scope) and persists flag", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "SCRUM" })

		const forbidden = mockJiraCreateWebhookForbidden()
		const res = await ensureJiraWebhook(db, user.id)
		expect(res.status).toBe("needs_reconnect")
		expect(forbidden.isDone()).toBe(true)

		const creds = await readJiraCreds(db, user.id)
		expect(creds?.jiraWebhook?.needsReconnect).toBe(true)
	})

	it("deletes the webhook when the last project leaves", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id)
		const sub = await addSubscription(db, user.id, { provider: "jira", scope: "ONLY" })

		mockJiraCreateWebhook(555)
		await ensureJiraWebhook(db, user.id)

		await db
			.update(subscriptionsTable)
			.set({ isActive: false })
			.where(eq(subscriptionsTable.id, sub.id))

		const delHook = mockJiraDeleteWebhook()
		const res = await ensureJiraWebhook(db, user.id)
		expect(res.status).toBe("deleted")
		expect(delHook.isDone()).toBe(true)

		const creds = await readJiraCreds(db, user.id)
		expect(creds?.jiraWebhook).toBeUndefined()
	})

	it("removeJiraWebhook clears local meta even if Jira DELETE fails", async () => {
		const user = await createTestUser(db)
		await addJiraConnection(db, user.id)
		await addSubscription(db, user.id, { provider: "jira", scope: "SCRUM" })

		mockJiraCreateWebhook(999)
		await ensureJiraWebhook(db, user.id)

		// Atlassian returns 500 — we should still clear local state.
		nock("https://api.atlassian.com")
			.delete(/\/ex\/jira\/[^/]+\/rest\/api\/3\/webhook$/)
			.reply(500, { error: "boom" })
		await removeJiraWebhook(db, user.id)

		const creds = await readJiraCreds(db, user.id)
		expect(creds?.jiraWebhook).toBeUndefined()
	})
})
