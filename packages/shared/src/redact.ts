export const SECRET_PATTERNS: RegExp[] = [
	/\bgh[a-z]_[A-Za-z0-9]{20,}\b/g,
	/Bearer\s+[A-Za-z0-9._-]{20,}/g,
]

export const redact = (value: unknown): unknown => {
	if (typeof value !== "string") return value
	let out = value
	for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]")
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
