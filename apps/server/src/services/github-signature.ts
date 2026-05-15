import { createHmac, timingSafeEqual } from "node:crypto"

// Pure HMAC check. Compares `sha256=<hex>` from the GitHub webhook
// signature header against HMAC-SHA256(rawBody) under the provided
// secret in constant time. Returns false on any malformed input.
//
// Extracted from ingest.ts so unit tests don't pull in db/config.
export const verifyGithubSignature = (
	signature: string | undefined,
	rawBody: string,
	secret: string,
): boolean => {
	if (!signature) return false
	const expectedPrefix = "sha256="
	if (!signature.startsWith(expectedPrefix)) return false
	const provided = Buffer.from(signature.slice(expectedPrefix.length), "hex")
	if (provided.length === 0) return false
	const computed = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "hex")
	if (computed.length !== provided.length) return false
	return timingSafeEqual(computed, provided)
}
