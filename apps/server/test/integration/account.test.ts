import { createCipher } from "@devpinger/crypto"
import {
	connections as connectionsTable,
	createDatabase,
	events as eventsTable,
	mutes as mutesTable,
	subscriptions as subscriptionsTable,
	users as usersTable,
} from "@devpinger/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("account data deletion cascade", () => {
	let db: ReturnType<typeof createDatabase>

	beforeAll(() => {
		db = createDatabase(integrationDbUrl as string)
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("removes every dependent row when a user is deleted", async () => {
		const cipher = createCipher("0".repeat(64))
		const [user] = await db
			.insert(usersTable)
			.values({
				telegramId: 900900900,
				telegramChatId: 900900900,
				telegramUsername: "deleteme",
				lang: "en",
			})
			.returning()
		const userId = user!.id

		await db.insert(connectionsTable).values({
			userId,
			provider: "github",
			providerUserId: "delete-1",
			providerUsername: "deleteme",
			encryptedCredentials: cipher.encrypt(JSON.stringify({ accessToken: "x" })),
		})
		await db.insert(subscriptionsTable).values({
			userId,
			provider: "github",
			providerScopeId: "deleteme/repo",
			displayName: "deleteme/repo",
			webhookSecret: "secret",
			isActive: true,
		})
		await db.insert(mutesTable).values({
			userId,
			scopeType: "repo",
			scopeValue: "deleteme/repo",
		})
		await db.insert(eventsTable).values({
			userId,
			source: "github",
			sourceEventId: "pull_request:cascade-1",
			type: "pull_request.opened",
			priority: "medium",
			title: "deleteme/repo #1: test",
			url: "https://github.com/deleteme/repo/pull/1",
			scope: "deleteme/repo",
		})

		await db.delete(usersTable).where(eq(usersTable.id, userId))

		const [u, c, s, m, e] = await Promise.all([
			db.select().from(usersTable).where(eq(usersTable.id, userId)),
			db.select().from(connectionsTable).where(eq(connectionsTable.userId, userId)),
			db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)),
			db.select().from(mutesTable).where(eq(mutesTable.userId, userId)),
			db.select().from(eventsTable).where(eq(eventsTable.userId, userId)),
		])
		expect(u).toHaveLength(0)
		expect(c).toHaveLength(0)
		expect(s).toHaveLength(0)
		expect(m).toHaveLength(0)
		expect(e).toHaveLength(0)
	})

	it("forget_event only deletes a single event scoped to the user", async () => {
		const [user] = await db
			.insert(usersTable)
			.values({
				telegramId: 901901901,
				telegramChatId: 901901901,
				telegramUsername: "forgetuser",
				lang: "en",
			})
			.returning()
		const userId = user!.id

		const [kept] = await db
			.insert(eventsTable)
			.values({
				userId,
				source: "github",
				sourceEventId: "pull_request:forget-keep",
				type: "pull_request.opened",
				priority: "medium",
				title: "kept",
				url: "https://github.com/u/r/pull/1",
			})
			.returning()
		const [target] = await db
			.insert(eventsTable)
			.values({
				userId,
				source: "github",
				sourceEventId: "pull_request:forget-target",
				type: "pull_request.opened",
				priority: "medium",
				title: "target",
				url: "https://github.com/u/r/pull/2",
			})
			.returning()

		const deleted = await db
			.delete(eventsTable)
			.where(eq(eventsTable.id, target!.id))
			.returning({ id: eventsTable.id })
		expect(deleted).toHaveLength(1)

		const [check] = await db.select().from(eventsTable).where(eq(eventsTable.id, kept!.id))
		expect(check).toBeDefined()
		expect(check?.title).toBe("kept")
	})
})
