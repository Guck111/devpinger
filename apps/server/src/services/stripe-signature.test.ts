import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { verifyStripeSignature } from "./stripe-signature.js"

const SECRET = "whsec_test_secret"
const BODY = '{"id":"evt_test","type":"checkout.session.completed"}'

const sign = (timestamp: number, body: string, secret = SECRET): string =>
	createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")

describe("verifyStripeSignature", () => {
	it("accepts a valid signature within tolerance", () => {
		const now = 1_700_000_000
		const sig = sign(now, BODY)
		const result = verifyStripeSignature({
			header: `t=${now},v1=${sig}`,
			rawBody: BODY,
			secret: SECRET,
			now,
		})
		expect(result).toEqual({ ok: true })
	})

	it("rejects a missing header", () => {
		const result = verifyStripeSignature({
			header: undefined,
			rawBody: BODY,
			secret: SECRET,
			now: 1_700_000_000,
		})
		expect(result).toEqual({ ok: false, reason: "header_missing" })
	})

	it("rejects a malformed header", () => {
		const result = verifyStripeSignature({
			header: "garbage",
			rawBody: BODY,
			secret: SECRET,
			now: 1_700_000_000,
		})
		expect(result).toEqual({ ok: false, reason: "header_malformed" })
	})

	it("rejects a stale timestamp outside the tolerance window", () => {
		const now = 1_700_000_000
		const old = now - 600
		const sig = sign(old, BODY)
		const result = verifyStripeSignature({
			header: `t=${old},v1=${sig}`,
			rawBody: BODY,
			secret: SECRET,
			now,
		})
		expect(result).toEqual({ ok: false, reason: "timestamp_stale" })
	})

	it("rejects a signature produced with a different secret", () => {
		const now = 1_700_000_000
		const sig = sign(now, BODY, "wrong_secret")
		const result = verifyStripeSignature({
			header: `t=${now},v1=${sig}`,
			rawBody: BODY,
			secret: SECRET,
			now,
		})
		expect(result).toEqual({ ok: false, reason: "no_match" })
	})

	it("rejects when the body has been tampered with", () => {
		const now = 1_700_000_000
		const sig = sign(now, BODY)
		const result = verifyStripeSignature({
			header: `t=${now},v1=${sig}`,
			rawBody: `${BODY}.tampered`,
			secret: SECRET,
			now,
		})
		expect(result).toEqual({ ok: false, reason: "no_match" })
	})

	it("accepts when at least one v1 signature in a multi-sig header matches", () => {
		const now = 1_700_000_000
		const good = sign(now, BODY)
		const bad = sign(now, "other", "other")
		const result = verifyStripeSignature({
			header: `t=${now},v1=${bad},v1=${good}`,
			rawBody: BODY,
			secret: SECRET,
			now,
		})
		expect(result).toEqual({ ok: true })
	})
})
