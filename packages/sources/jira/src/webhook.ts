// Jira Cloud webhooks do not ship HMAC signing by default — the recommended
// approach is a shared secret in a query parameter on the registered URL
// (the Atlassian "Webhooks" admin screen lets you append `?secret=…`). We
// expect the secret on the `X-Devping-Webhook-Secret` header OR the
// `secret` query parameter and timing-safe-compare it.

import { timingSafeEqual } from "node:crypto"

const safeStringEqual = (a: string, b: string): boolean => {
	const ab = Buffer.from(a)
	const bb = Buffer.from(b)
	if (ab.length !== bb.length) return false
	return timingSafeEqual(ab, bb)
}

export const verifyJiraSecret = (provided: string | undefined, expected: string): boolean => {
	if (!provided || !expected) return false
	return safeStringEqual(provided, expected)
}
