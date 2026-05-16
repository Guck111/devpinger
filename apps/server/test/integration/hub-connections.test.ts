import { createDatabase } from "@devpinger/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderConnectionsSection } from "../../src/bot/hub/connections.js"
import { addGitHubConnection, createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("hub: connections section", () => {
	let db: ReturnType<typeof createDatabase>

	beforeAll(() => {
		db = createDatabase(integrationDbUrl as string)
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("shows github as connected with login when connection exists", async () => {
		const user = await createTestUser(db)
		await addGitHubConnection(db, user.id, { username: "octocat" })
		const t = (k: string, p?: Record<string, string | number>) => {
			const map: Record<string, string> = {
				"hubV2.connections.title": "📡 Connections",
				"hubV2.connections.githubConnected": `✅ GitHub: @${p?.login ?? ""}`,
				"hubV2.connections.openRepos": "📁 Repositories",
				"hubV2.connections.disconnect": "🔌 Disconnect",
				"hubV2.connections.jiraConnect": "🟦 Connect Jira",
				"hubV2.close": "✖ Close",
			}
			return map[k] ?? k
		}
		const rendered = await renderConnectionsSection({
			db,
			userId: user.id,
			t,
			oauthUrl: (p) => `https://example.com/oauth/${p}/start`,
		})
		expect(rendered.text).toContain("📡 Connections")
		const buttons = rendered.keyboard.inline_keyboard.flat()
		expect(buttons.some((b) => "text" in b && b.text === "✅ GitHub: @octocat")).toBe(true)
		expect(buttons.some((b) => "text" in b && b.text === "📁 Repositories")).toBe(true)
		expect(buttons.some((b) => "text" in b && b.text === "🔌 Disconnect")).toBe(true)
		expect(buttons.some((b) => "url" in b)).toBe(true)
	})
})
