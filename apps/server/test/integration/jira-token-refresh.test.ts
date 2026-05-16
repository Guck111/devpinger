import { createCipher } from "@devpinger/crypto"
import { connections as connectionsTable, createDatabase, users as usersTable } from "@devpinger/db"
import { and, eq } from "drizzle-orm"
import nock from "nock"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

const ENC_KEY = "0".repeat(64)

const seedJiraConnection = async (
	db: ReturnType<typeof createDatabase>,
	userId: string,
	creds: {
		accessToken: string
		refreshToken?: string
		expiresAt?: string
		jiraCloudId?: string
	},
) => {
	const cipher = createCipher(ENC_KEY)
	const [conn] = await db
		.insert(connectionsTable)
		.values({
			userId,
			provider: "jira",
			providerUserId: "jira-acct",
			providerUsername: "JiraUser",
			encryptedCredentials: cipher.encrypt(
				JSON.stringify({
					accessToken: creds.accessToken,
					refreshToken: creds.refreshToken,
					expiresAt: creds.expiresAt,
					jiraCloudId: creds.jiraCloudId ?? "cloud-test",
					scopes: ["read:jira-work", "write:jira-work", "offline_access"],
				}),
			),
		})
		.returning()
	if (!conn) throw new Error("seedJiraConnection failed")
	return conn
}

type ConnectionsMod = typeof import("../../src/services/connections.js")

describe.skipIf(skip)("Jira token refresh", () => {
	let db: ReturnType<typeof createDatabase>
	let getFreshJiraConnection: ConnectionsMod["getFreshJiraConnection"]

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const mod = await import("../../src/services/connections.js")
		getFreshJiraConnection = mod.getFreshJiraConnection
	})

	beforeEach(() => {
		nock.cleanAll()
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("refreshes the access token when it expires within the buffer", async () => {
		const user = await createTestUser(db)
		const soon = new Date(Date.now() + 30_000).toISOString()
		const conn = await seedJiraConnection(db, user.id, {
			accessToken: "OLD_ACCESS",
			refreshToken: "REFRESH_TOKEN_OLD",
			expiresAt: soon,
		})

		const refreshNock = nock("https://auth.atlassian.com").post("/oauth/token").reply(200, {
			access_token: "NEW_ACCESS",
			refresh_token: "REFRESH_TOKEN_NEW",
			token_type: "Bearer",
			scope: "read:jira-work write:jira-work offline_access",
			expires_in: 3600,
		})

		const fresh = await getFreshJiraConnection(db, user.id)
		expect(fresh).not.toBeNull()
		expect(fresh!.credentials.accessToken).toBe("NEW_ACCESS")
		expect(fresh!.credentials.refreshToken).toBe("REFRESH_TOKEN_NEW")
		expect(refreshNock.isDone()).toBe(true)

		const cipher = createCipher(ENC_KEY)
		const [row] = await db
			.select()
			.from(connectionsTable)
			.where(eq(connectionsTable.id, conn.id))
			.limit(1)
		const persisted = JSON.parse(cipher.decrypt(row!.encryptedCredentials)) as {
			accessToken: string
			refreshToken: string
			expiresAt: string
		}
		expect(persisted.accessToken).toBe("NEW_ACCESS")
		expect(persisted.refreshToken).toBe("REFRESH_TOKEN_NEW")
		expect(Date.parse(persisted.expiresAt)).toBeGreaterThan(Date.now() + 60 * 60 * 1000 - 5_000)
	})

	it("does NOT refresh when the access token is still fresh", async () => {
		const user = await createTestUser(db)
		const farFuture = new Date(Date.now() + 30 * 60_000).toISOString()
		await seedJiraConnection(db, user.id, {
			accessToken: "STILL_FRESH",
			refreshToken: "REFRESH_TOKEN_X",
			expiresAt: farFuture,
		})

		const refreshNock = nock("https://auth.atlassian.com").post("/oauth/token").reply(500)

		const fresh = await getFreshJiraConnection(db, user.id)
		expect(fresh).not.toBeNull()
		expect(fresh!.credentials.accessToken).toBe("STILL_FRESH")
		expect(refreshNock.isDone()).toBe(false)
		nock.cleanAll()
	})

	it("returns the existing connection if refresh fails (caller should surface reconnect)", async () => {
		const user = await createTestUser(db)
		const soon = new Date(Date.now() + 10_000).toISOString()
		await seedJiraConnection(db, user.id, {
			accessToken: "STALE",
			refreshToken: "REFRESH_TOKEN_BAD",
			expiresAt: soon,
		})

		const refreshNock = nock("https://auth.atlassian.com")
			.post("/oauth/token")
			.reply(400, { error: "invalid_grant" })

		const fresh = await getFreshJiraConnection(db, user.id)
		expect(fresh).not.toBeNull()
		expect(fresh!.credentials.accessToken).toBe("STALE")
		expect(refreshNock.isDone()).toBe(true)
	})

	it("returns the existing connection when no expiresAt is tracked (pre-fix data)", async () => {
		const user = await createTestUser(db)
		await seedJiraConnection(db, user.id, {
			accessToken: "LEGACY",
			refreshToken: "REFRESH_LEGACY",
		})

		const refreshNock = nock("https://auth.atlassian.com").post("/oauth/token").reply(500)

		const fresh = await getFreshJiraConnection(db, user.id)
		expect(fresh).not.toBeNull()
		expect(fresh!.credentials.accessToken).toBe("LEGACY")
		expect(refreshNock.isDone()).toBe(false)
		nock.cleanAll()

		// Sanity: user has exactly one Jira connection.
		const conns = await db
			.select()
			.from(connectionsTable)
			.where(and(eq(connectionsTable.userId, user.id), eq(connectionsTable.provider, "jira")))
		expect(conns).toHaveLength(1)
		// Sanity: user row is intact.
		const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1)
		expect(u).toBeDefined()
	})
})
