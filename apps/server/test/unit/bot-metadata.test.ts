import { describe, expect, it, vi } from "vitest"
import { registerBotMetadata } from "../../src/bot/metadata.js"

describe("registerBotMetadata", () => {
	it("sets short and long description for en and ru", async () => {
		const setMyDescription = vi.fn().mockResolvedValue(true)
		const setMyShortDescription = vi.fn().mockResolvedValue(true)
		const api = { setMyDescription, setMyShortDescription } as unknown as Parameters<
			typeof registerBotMetadata
		>[0]

		await registerBotMetadata(api)

		expect(setMyShortDescription).toHaveBeenCalledTimes(2)
		expect(setMyShortDescription).toHaveBeenCalledWith(expect.stringMatching(/one-tap/i))
		expect(setMyShortDescription).toHaveBeenCalledWith(
			expect.stringMatching(/одной кнопкой/i),
			{ language_code: "ru" },
		)
		expect(setMyDescription).toHaveBeenCalledTimes(2)
		expect(setMyDescription).toHaveBeenCalledWith(expect.stringMatching(/DevPinger/))
		expect(setMyDescription).toHaveBeenCalledWith(expect.stringMatching(/DevPinger/), {
			language_code: "ru",
		})
	})
})
