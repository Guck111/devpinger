import { describe, expect, it } from "vitest"
import { redact, redactObject } from "./redact.js"

describe("redact", () => {
	it("masks GitHub OAuth tokens", () => {
		const masked = redact("authorization: token gho_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
		expect(masked).toBe("authorization: token [REDACTED]")
	})

	it("masks GitHub fine-grained tokens", () => {
		expect(redact("ghp_1234567890abcdefghijklmnopqrstuvwxyz")).toBe("[REDACTED]")
	})

	it("masks Bearer headers", () => {
		expect(redact("authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toBe(
			"authorization: [REDACTED]",
		)
	})

	it("masks the value of a Jira ?secret=... query parameter", () => {
		const url = "POST /webhooks/jira/conn-123?secret=TENANT_SECRET_XYZ failed"
		expect(redact(url)).toBe("POST /webhooks/jira/conn-123?secret=[REDACTED] failed")
	})

	it("masks &secret= when it isn't the first query parameter", () => {
		const url = "/webhooks/jira/conn?foo=bar&secret=ABC123 boom"
		expect(redact(url)).toBe("/webhooks/jira/conn?foo=bar&secret=[REDACTED] boom")
	})

	it("passes through unrelated text untouched", () => {
		expect(redact("just a regular error message")).toBe("just a regular error message")
	})

	it("returns non-strings unchanged", () => {
		expect(redact(42)).toBe(42)
		expect(redact(null)).toBe(null)
		expect(redact(undefined)).toBe(undefined)
	})

	it("redactObject masks every string field but keeps shape", () => {
		const out = redactObject({
			tag: "billing",
			token: "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			count: 3,
		})
		expect(out).toEqual({ tag: "billing", token: "[REDACTED]", count: 3 })
	})

	it("redactObject returns undefined when given undefined", () => {
		expect(redactObject(undefined)).toBeUndefined()
	})
})
