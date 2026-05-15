import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { verifyGithubSignature } from "./github-signature.js"

const SECRET = "deadbeef-deadbeef-deadbeef-32-bytes-min"
const BODY = '{"action":"opened","number":42}'

const sign = (body: string, secret: string): string =>
	`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

describe("verifyGithubSignature", () => {
	it("accepts a valid signature", () => {
		expect(verifyGithubSignature(sign(BODY, SECRET), BODY, SECRET)).toBe(true)
	})

	it("rejects when the signature header is missing", () => {
		expect(verifyGithubSignature(undefined, BODY, SECRET)).toBe(false)
	})

	it("rejects when the signature lacks the sha256= prefix", () => {
		const bareHex = createHmac("sha256", SECRET).update(BODY).digest("hex")
		expect(verifyGithubSignature(bareHex, BODY, SECRET)).toBe(false)
	})

	it("rejects when the body was tampered with after signing", () => {
		const valid = sign(BODY, SECRET)
		expect(verifyGithubSignature(valid, `${BODY} TAMPER`, SECRET)).toBe(false)
	})

	it("rejects when the wrong secret is used", () => {
		const fromAttacker = sign(BODY, "attacker-secret")
		expect(verifyGithubSignature(fromAttacker, BODY, SECRET)).toBe(false)
	})

	it("rejects when the hex payload is empty", () => {
		expect(verifyGithubSignature("sha256=", BODY, SECRET)).toBe(false)
	})

	it("rejects when the hex payload is the wrong length", () => {
		expect(verifyGithubSignature("sha256=AABBCC", BODY, SECRET)).toBe(false)
	})

	it("accepts signatures for an empty body", () => {
		expect(verifyGithubSignature(sign("", SECRET), "", SECRET)).toBe(true)
	})

	it("is binary-safe: different bytes don't collide", () => {
		const sigA = sign("a", SECRET)
		expect(verifyGithubSignature(sigA, "b", SECRET)).toBe(false)
	})

	it("rejects garbage in the hex portion", () => {
		expect(verifyGithubSignature("sha256=ZZZZ", BODY, SECRET)).toBe(false)
	})
})
