import { describe, expect, it } from "vitest"
import { signTg, verifyTg } from "./signed-tg.js"

const SECRET = "secret-123-abcdefghijklmnopqrstuvwxyz"

describe("signTg / verifyTg", () => {
	it("round-trips a valid token", () => {
		const tg = 12345
		const token = signTg(tg, "oauth-github-start", SECRET)
		expect(verifyTg(token, "oauth-github-start", SECRET)).toBe(tg)
	})

	it("rejects a tampered signature", () => {
		const token = signTg(12345, "oauth-github-start", SECRET)
		const tampered = `${token.slice(0, -2)}AA`
		expect(verifyTg(tampered, "oauth-github-start", SECRET)).toBeNull()
	})

	it("rejects a tampered payload", () => {
		const token = signTg(12345, "oauth-github-start", SECRET)
		const parts = token.split(".")
		const tamperedPayload = `${parts[0]?.slice(0, -2)}xx.${parts[1]}`
		expect(verifyTg(tamperedPayload, "oauth-github-start", SECRET)).toBeNull()
	})

	it("rejects a token signed with a different secret", () => {
		const token = signTg(12345, "oauth-github-start", SECRET)
		expect(verifyTg(token, "oauth-github-start", "another-secret-32-chars-aaaaaaa")).toBeNull()
	})

	it("rejects a token issued for a different purpose", () => {
		const token = signTg(12345, "oauth-github-start", SECRET)
		expect(verifyTg(token, "oauth-jira-start", SECRET)).toBeNull()
	})

	it("rejects an expired token", () => {
		const token = signTg(12345, "x", SECRET, { ttlMs: 1000, now: 1_000_000 })
		expect(verifyTg(token, "x", SECRET, 1_000_000 + 5_000)).toBeNull()
	})

	it("accepts a token within its TTL", () => {
		const token = signTg(12345, "x", SECRET, { ttlMs: 60_000, now: 1_000_000 })
		expect(verifyTg(token, "x", SECRET, 1_000_000 + 30_000)).toBe(12345)
	})

	it("throws on non-positive tg ids", () => {
		expect(() => signTg(0, "x", SECRET)).toThrow(/positive integer/)
		expect(() => signTg(-1, "x", SECRET)).toThrow(/positive integer/)
	})

	it("returns null when the token has wrong shape", () => {
		expect(verifyTg("no-dot-here", "x", SECRET)).toBeNull()
		expect(verifyTg("", "x", SECRET)).toBeNull()
		expect(verifyTg(".justsig", "x", SECRET)).toBeNull()
		expect(verifyTg("justpayload.", "x", SECRET)).toBeNull()
	})

	it("returns null when payload base64 decodes to garbage", () => {
		expect(verifyTg("@@@.AAAA", "x", SECRET)).toBeNull()
	})
})
