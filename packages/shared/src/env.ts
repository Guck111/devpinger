import { z } from "zod"

const serverEnvSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	PORT: z.coerce.number().default(3001),
	LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
	PUBLIC_BASE_URL: z.string().url(),
	DATABASE_URL: z.string().url(),
	DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
	REDIS_URL: z.string().url(),
	TELEGRAM_BOT_TOKEN: z.string().min(1),
	TELEGRAM_BOT_USERNAME: z.string().min(1),
	TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
	ENCRYPTION_KEY: z
		.string()
		.regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
	GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
	GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),
	GITHUB_OAUTH_REDIRECT_URI: z.string().url(),
	GITHUB_WEBHOOK_SECRET_SEED: z.string().min(32),
	JIRA_OAUTH_CLIENT_ID: z.string().min(1),
	JIRA_OAUTH_CLIENT_SECRET: z.string().min(1),
	JIRA_OAUTH_REDIRECT_URI: z.string().url(),
	SENTRY_DSN: z.string().url().optional(),
	// Telegram ID of the operator. Gates admin-only bot commands
	// (e.g. /notify_self). Optional in production where admin actions
	// happen via DB / SQL.
	ADMIN_TELEGRAM_ID: z.coerce.number().int().positive().optional(),
	// Comma-separated list of origins allowed to call public landing endpoints
	// (POST /v1/landing/subscribe). Browser cross-origin only — webhooks server-to-server
	// pass without an Origin header and are unaffected.
	LANDING_ALLOWED_ORIGINS: z
		.string()
		.default(
			"https://devpinger.com,https://www.devpinger.com,https://preorder.devpinger.com,http://localhost:4321",
		),
	// Stripe webhook signing secret (whsec_…). Required to verify checkout.session.completed
	// events from the preorder Payment Link. Optional in dev — without it /v1/stripe/webhook
	// returns 503 instead of accepting unverified payloads.
	STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
	// Lifetime preorder total seats. Controls the /v1/landing/seats endpoint and the badge.
	// Stripe enforces the actual cap on the Payment Link side.
	PREORDER_TOTAL_SEATS: z.coerce.number().int().positive().default(30),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export const loadServerEnv = (source: NodeJS.ProcessEnv = process.env): ServerEnv => {
	const cleaned: NodeJS.ProcessEnv = {}
	for (const [key, value] of Object.entries(source)) {
		if (value !== "") cleaned[key] = value
	}
	const parsed = serverEnvSchema.safeParse(cleaned)
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
			.join("\n")
		throw new Error(`Invalid server environment variables:\n${issues}`)
	}
	return parsed.data
}
