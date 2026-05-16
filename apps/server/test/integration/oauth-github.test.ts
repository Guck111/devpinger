import { createCipher } from "@devpinger/crypto"
import {
	connections as connectionsTable,
	createDatabase,
	oauthStates as oauthStatesTable,
} from "@devpinger/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mockGitHubOAuthExchange, mockGitHubUserApi } from "./helpers/nock-helpers.js"
import { createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("OAuth GitHub callback", () => {
	let db: ReturnType<typeof createDatabase>
	let app: Awaited<ReturnType<typeof import("../../src/server.js").createApp>>
	let createOauthState: typeof import("../../src/services/oauth-state.js").createOauthState
	let appModule: typeof import("../../src/server.js")

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		appModule = await import("../../src/server.js")
		app = await appModule.createApp()
		const oauthState = await import("../../src/services/oauth-state.js")
		createOauthState = oauthState.createOauthState
	})

	afterAll(async () => {
		await app.close()
		await db.$client.end({ timeout: 5 })
	})

	it("creates an encrypted GitHub connection and redirects to bot", async () => {
		const user = await createTestUser(db)

		const state = await createOauthState(db, {
			userId: user.id,
			provider: "github",
		})

		const tokenExchange = mockGitHubOAuthExchange("ghp_new_access_token")
		const userApi = mockGitHubUserApi({ username: "ghuser_test", id: 7777 })

		const res = await app.inject({
			method: "GET",
			url: `/oauth/github/callback?code=oauth_code_42&state=${state}`,
		})

		expect(res.statusCode).toBe(302)
		expect(res.headers.location).toMatch(/^https:\/\/t\.me\//)
		expect(res.headers.location).toContain("connected_github")
		expect(tokenExchange.isDone()).toBe(true)
		expect(userApi.isDone()).toBe(true)

		const conns = await db
			.select()
			.from(connectionsTable)
			.where(eq(connectionsTable.userId, user.id))
		expect(conns).toHaveLength(1)
		const conn = conns[0]!
		expect(conn.provider).toBe("github")
		expect(conn.providerUsername).toBe("ghuser_test")
		expect(conn.providerUserId).toBe("7777")

		const cipher = createCipher("0".repeat(64))
		const decrypted = JSON.parse(cipher.decrypt(conn.encryptedCredentials)) as {
			accessToken: string
			scopes: string[]
		}
		expect(decrypted.accessToken).toBe("ghp_new_access_token")
		expect(decrypted.scopes).toContain("repo")

		const remainingStates = await db
			.select()
			.from(oauthStatesTable)
			.where(eq(oauthStatesTable.state, state))
		expect(remainingStates).toHaveLength(0)
	})

	it("rejects callback with unknown state token", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/oauth/github/callback?code=oauth_code_99&state=unknown_state_token",
		})
		expect(res.statusCode).toBe(400)
		expect(res.json()).toMatchObject({ error: expect.stringContaining("state") })
	})

	it("rejects callback with missing params", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/oauth/github/callback?code=oauth_code_only",
		})
		expect(res.statusCode).toBe(400)
	})
})
