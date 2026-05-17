export const SECRET_PATTERNS: RegExp[] = [
	/\bgh[a-z]_[A-Za-z0-9]{20,}\b/g,
	/Bearer\s+[A-Za-z0-9._-]{20,}/g,
	// Jira Dynamic Webhooks carry the per-tenant secret in the URL as
	// ?secret=<base64url>; mask the value but keep the surrounding URL
	// readable so log lines still tell us which route was hit.
	/([?&]secret=)[^\s&"'<>]+/gi,
]

export const redact = (value: unknown): unknown => {
	if (typeof value !== "string") return value
	let out = value
	for (const re of SECRET_PATTERNS) {
		// The Jira ?secret= pattern has a capture group so it can preserve
		// the key prefix; the github/Bearer ones replace the whole match.
		out = re.source.includes("(") ? out.replace(re, "$1[REDACTED]") : out.replace(re, "[REDACTED]")
	}
	return out
}

export const redactObject = (
	context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
	if (!context) return context
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(context)) out[k] = redact(v)
	return out
}
