import { createHmac, timingSafeEqual } from "node:crypto"

const DEFAULT_TOLERANCE_SECONDS = 5 * 60

export type StripeSignatureResult =
	| { ok: true }
	| { ok: false; reason: "header_missing" | "header_malformed" | "timestamp_stale" | "no_match" }

const parseHeader = (header: string): { timestamp: number; signatures: string[] } | null => {
	let timestamp: number | null = null
	const signatures: string[] = []
	for (const part of header.split(",")) {
		const [key, value] = part.split("=", 2)
		if (!key || !value) continue
		if (key === "t") {
			const parsed = Number.parseInt(value, 10)
			if (Number.isFinite(parsed)) timestamp = parsed
		} else if (key === "v1") {
			signatures.push(value)
		}
	}
	if (timestamp === null || signatures.length === 0) return null
	return { timestamp, signatures }
}

const safeEqualHex = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false
	const bufA = Buffer.from(a, "hex")
	const bufB = Buffer.from(b, "hex")
	if (bufA.length !== bufB.length) return false
	return timingSafeEqual(bufA, bufB)
}

export interface VerifyOptions {
	header: string | undefined
	rawBody: string
	secret: string
	now?: number
	toleranceSeconds?: number
}

export const verifyStripeSignature = ({
	header,
	rawBody,
	secret,
	now = Math.floor(Date.now() / 1000),
	toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
}: VerifyOptions): StripeSignatureResult => {
	if (!header) return { ok: false, reason: "header_missing" }
	const parsed = parseHeader(header)
	if (!parsed) return { ok: false, reason: "header_malformed" }
	if (Math.abs(now - parsed.timestamp) > toleranceSeconds) {
		return { ok: false, reason: "timestamp_stale" }
	}
	const signedPayload = `${parsed.timestamp}.${rawBody}`
	const expected = createHmac("sha256", secret).update(signedPayload).digest("hex")
	for (const candidate of parsed.signatures) {
		if (safeEqualHex(candidate, expected)) return { ok: true }
	}
	return { ok: false, reason: "no_match" }
}
