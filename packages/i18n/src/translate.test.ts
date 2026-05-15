import { describe, expect, it } from "vitest"
import { createTranslator } from "./translate.js"

describe("createTranslator", () => {
	const messages = {
		hello: "Hi @{username}!",
		nested: {
			greeting: "Welcome, {name}",
		},
	}

	it("returns the string for a top-level key", () => {
		const t = createTranslator(messages)
		expect(t("hello", { username: "alex" })).toBe("Hi @alex!")
	})

	it("resolves nested keys via dot notation", () => {
		const t = createTranslator(messages)
		expect(t("nested.greeting", { name: "Sam" })).toBe("Welcome, Sam")
	})

	it("returns the key itself when not found", () => {
		const t = createTranslator(messages)
		expect(t("missing.key")).toBe("missing.key")
	})

	it("leaves placeholders intact when params missing", () => {
		const t = createTranslator(messages)
		expect(t("hello")).toBe("Hi @{username}!")
	})

	it("supports number params", () => {
		const t = createTranslator({ count: "{n} items" })
		expect(t("count", { n: 5 })).toBe("5 items")
	})
})
