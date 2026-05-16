import { createCipher } from "@devpinger/crypto"
import {
	connections as connectionsTable,
	createDatabase,
	oauthStates as oauthStatesTable,
} from "@devpinger/db"
import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	mockJiraAccessibleResources,
	mockJiraMyself,
	mockJiraOAuthExchange,
} from "./helpers/nock-helpers.js"
import { createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("OAuth Jira callback", () => {
	let db: ReturnType<typeof createDatabase>
	let app: FastifyInstance
	let createOauthState: typeof import("../../src/services/oauth-state.js").createOauthState

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		const serverModule = await import("../../src/server.js")
		app = await serverModule.createApp()
		const oauthState = await import("../../src/services/oauth-state.js")
		createOauthState = oauthState.createOauthState
	})

	afterAll(async () => {
		await app.close()
		await db.$client.end({ timeout: 5 })
	})

	it("creates an encrypted Jira connection with cloudId and redirects to bot", async () => {
		const user = await createTestUser(db)
		const state = await createOauthState(db, { userId: user.id, provider: "jira" })

		const tokenExchange = mockJiraOAuthExchange("jira_new_access_token")
		const resources = mockJiraAccessibleResources({
			cloudId: "cloud-xyz",
			siteUrl: "https://test-site.atlassian.net",
		})
		const myself = mockJiraMyself()

		const res = await app.inject({
			method: "GET",
			url: `/oauth/jira/callback?code=jira_oauth_code&state=${state}`,
		})

		expect(res.statusCode).toBe(302)
		expect(res.headers.location).toMatch(/^https:\/\/t\.me\//)
		expect(res.headers.location).toContain("connected_jira")
		expect(tokenExchange.isDone()).toBe(true)
		expect(resources.isDone()).toBe(true)
		expect(myself.isDone()).toBe(true)

		const conns = await db
			.select()
			.from(connectionsTable)
			.where(eq(connectionsTable.userId, user.id))
		expect(conns).toHaveLength(1)
		const conn = conns[0]!
		expect(conn.provider).toBe("jira")
		expect(conn.providerUserId).toBe("jira-account-1")
		expect(conn.providerUsername).toBe("Test User")

		const cipher = createCipher("0".repeat(64))
		const decrypted = JSON.parse(cipher.decrypt(conn.encryptedCredentials)) as {
			accessToken: string
			refreshToken: string
			jiraCloudId: string
			scopes?: string[]
		}
		expect(decrypted.accessToken).toBe("jira_new_access_token")
		expect(decrypted.refreshToken).toBe("refresh_token")
		expect(decrypted.jiraCloudId).toBe("cloud-xyz")

		const remainingStates = await db
			.select()
			.from(oauthStatesTable)
			.where(eq(oauthStatesTable.state, state))
		expect(remainingStates).toHaveLength(0)
	})

	it("rejects callback with state belonging to wrong provider", async () => {
		const user = await createTestUser(db)
		// Create a GitHub state but try to consume it via Jira callback.
		const ghState = await createOauthState(db, { userId: user.id, provider: "github" })

		const res = await app.inject({
			method: "GET",
			url: `/oauth/jira/callback?code=any_code&state=${ghState}`,
		})
		expect(res.statusCode).toBe(400)
		expect(res.json()).toMatchObject({ error: expect.stringContaining("state") })
	})

	it("rejects callback with missing params", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/oauth/jira/callback?state=only_state",
		})
		expect(res.statusCode).toBe(400)
	})
})
