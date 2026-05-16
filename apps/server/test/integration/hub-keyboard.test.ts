import { describe, expect, it } from "vitest"
import { isMainKeyboardText, mainReplyKeyboard } from "../../src/bot/hub/keyboard.js"

describe("mainReplyKeyboard", () => {
	it("returns 2x2 layout localized to ru", () => {
		const kb = mainReplyKeyboard((k) => {
			const ru: Record<string, string> = {
				"replyKeyboard.connections": "📡 Подключения",
				"replyKeyboard.events": "🔔 События",
				"replyKeyboard.settings": "⚙️ Настройки",
				"replyKeyboard.help": "❓ Помощь",
			}
			return ru[k] ?? k
		})
		const rows = kb.keyboard
		expect(rows[0]).toEqual([{ text: "📡 Подключения" }, { text: "🔔 События" }])
		expect(rows[1]).toEqual([{ text: "⚙️ Настройки" }, { text: "❓ Помощь" }])
	})

	it("isMainKeyboardText matches localized labels in en and ru", () => {
		expect(isMainKeyboardText("📡 Подключения")).toBe("connections")
		expect(isMainKeyboardText("📡 Connections")).toBe("connections")
		expect(isMainKeyboardText("🔔 События")).toBe("events")
		expect(isMainKeyboardText("⚙️ Settings")).toBe("settings")
		expect(isMainKeyboardText("❓ Help")).toBe("help")
		expect(isMainKeyboardText("nothing")).toBeNull()
	})
})
