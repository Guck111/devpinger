import { describe, expect, it } from "vitest"
import { handleHelpCommand } from "../../src/bot/help.js"

describe("handleHelpCommand", () => {
	it("renders helpV2 text in HTML mode", async () => {
		const replies: { text: string; opts?: Record<string, unknown> }[] = []
		const ctx = {
			locale: "en" as const,
			t: (key: string) => (key === "helpV2.text" ? "🤖 <b>What I do</b>\n..." : key),
			reply: async (text: string, opts?: Record<string, unknown>) => {
				replies.push({ text, opts })
			},
		} as unknown as Parameters<typeof handleHelpCommand>[0]

		await handleHelpCommand(ctx)

		expect(replies).toHaveLength(1)
		expect(replies[0]?.text).toContain("What I do")
		expect(replies[0]?.opts).toMatchObject({ parse_mode: "HTML" })
	})
})
