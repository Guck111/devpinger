import { describe, expect, it } from "vitest"
import { renderEventsSection } from "../../src/bot/hub/events.js"

describe("hub: events section", () => {
	it("renders 3 inline buttons and a close button", () => {
		const t = (k: string) => {
			const map: Record<string, string> = {
				"hubV2.events.title": "🔔 Events",
				"hubV2.events.recent": "📜 Last 20",
				"hubV2.events.stats": "📊 Stats",
				"hubV2.events.mutes": "🔕 Mutes",
				"hubV2.close": "✖ Close",
			}
			return map[k] ?? k
		}
		const r = renderEventsSection(t)
		expect(r.text).toContain("Events")
		const labels = r.keyboard.inline_keyboard.flat().map((b) => ("text" in b ? b.text : ""))
		expect(labels).toEqual(["📜 Last 20", "📊 Stats", "🔕 Mutes", "✖ Close"])
	})
})
