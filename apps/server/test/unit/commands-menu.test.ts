import { describe, expect, it, vi } from "vitest"
import { registerBotCommands } from "../../src/bot/commands-menu.js"

describe("registerBotCommands", () => {
	it("publishes 9 commands and omits the hidden ones", async () => {
		const setMyCommands = vi.fn().mockResolvedValue(true)
		const api = { setMyCommands } as unknown as Parameters<typeof registerBotCommands>[0]

		await registerBotCommands(api)

		expect(setMyCommands).toHaveBeenCalledTimes(2)
		const [enCall, ruCall] = setMyCommands.mock.calls
		const [enCommands] = enCall as [{ command: string }[]]
		const [ruCommands, ruOpts] = ruCall as [{ command: string }[], { language_code: string }]

		expect(enCommands).toHaveLength(9)
		expect(ruCommands).toHaveLength(9)
		expect(ruOpts).toEqual({ language_code: "ru" })

		const cmds = enCommands.map((c) => c.command)
		expect(cmds).toEqual([
			"start",
			"help",
			"repos",
			"projects",
			"mutes",
			"recent",
			"stats",
			"lang",
			"cancel",
		])
		for (const hidden of [
			"sources",
			"export",
			"unsubscribe",
			"forget_event",
			"notify_self",
			"status",
		]) {
			expect(cmds).not.toContain(hidden)
		}
	})
})
