import { createHmac, timingSafeEqual } from "node:crypto"

const DEFAULT_TTL_MS = 5 * 60 * 1000

interface SignedPayload {
	tg: number
	purpose: string
	exp: number
}

const deriveKey = (secret: string): string =>
	createHmac("sha256", secret).update("url-signing-v1").digest("base64")

const safeEqual = (a: Buffer, b: Buffer): boolean => {
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}

export const signTg = (
	tg: number,
	purpose: string,
	secret: string,
	options: { ttlMs?: number; now?: number } = {},
): string => {
	if (!Number.isInteger(tg) || tg <= 0) {
		throw new Error("tg must be a positive integer")
	}
	const now = options.now ?? Date.now()
	const exp = now + (options.ttlMs ?? DEFAULT_TTL_MS)
	const payload: SignedPayload = { tg, purpose, exp }
	const data = Buffer.from(JSON.stringify(payload)).toString("base64url")
	const sig = createHmac("sha256", deriveKey(secret)).update(data).digest("base64url")
	return `${data}.${sig}`
}

export const verifyTg = (
	token: string,
	expectedPurpose: string,
	secret: string,
	now: number = Date.now(),
): number | null => {
	const parts = token.split(".")
	if (parts.length !== 2) return null
	const [data, sig] = parts
	if (!data || !sig) return null

	const expected = createHmac("sha256", deriveKey(secret)).update(data).digest("base64url")
	const sigBuf = Buffer.from(sig, "base64url")
	const expectedBuf = Buffer.from(expected, "base64url")
	if (!safeEqual(sigBuf, expectedBuf)) return null

	try {
		const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as SignedPayload
		if (typeof payload.tg !== "number" || !Number.isInteger(payload.tg) || payload.tg <= 0) {
			return null
		}
		if (payload.purpose !== expectedPurpose) return null
		if (typeof payload.exp !== "number" || payload.exp < now) return null
		return payload.tg
	} catch {
		return null
	}
}
