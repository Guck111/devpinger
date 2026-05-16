import { createDatabase, users } from "@devpinger/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderSettingsSection, toggleNotifySelf } from "../../src/bot/hub/settings.js"
import { createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("hub: settings section", () => {
	let db: ReturnType<typeof createDatabase>

	beforeAll(() => {
		db = createDatabase(integrationDbUrl as string)
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("renders 3 entries with current language", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			if (k === "hubV2.settings.lang") return `🌐 Language: ${p?.current}`
			if (k === "hubV2.settings.title") return "⚙️ Settings"
			if (k === "hubV2.settings.notifications") return "🔔 Notifications"
			if (k === "hubV2.settings.account") return "👤 Account"
			if (k === "hubV2.close") return "✖ Close"
			return k
		}
		const r = renderSettingsSection(t, "ru")
		expect(r.text).toContain("Settings")
		expect(r.keyboard.inline_keyboard.flat().map((b) => ("text" in b ? b.text : ""))).toEqual([
			"🌐 Language: ru",
			"🔔 Notifications",
			"👤 Account",
			"✖ Close",
		])
	})

	it("toggleNotifySelf flips and persists state", async () => {
		const user = await createTestUser(db, { notifySelfActions: false })
		const after = await toggleNotifySelf(db, user.id)
		expect(after).toBe(true)
		const after2 = await toggleNotifySelf(db, user.id)
		expect(after2).toBe(false)
		const [row] = await db.select().from(users).where(eq(users.id, user.id))
		expect(row?.notifySelfActions).toBe(false)
	})
})
