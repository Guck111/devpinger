import { describe, expect, it } from "vitest"
import { loadServerEnv } from "./env.js"

const baseEnv: NodeJS.ProcessEnv = {
	PUBLIC_BASE_URL: "https://example.com",
	DATABASE_URL: "postgres://u:p@h:5432/db",
	REDIS_URL: "redis://h:6379",
	TELEGRAM_BOT_TOKEN: "test:tok",
	TELEGRAM_BOT_USERNAME: "test_bot",
	TELEGRAM_WEBHOOK_SECRET: "1234567890abcdef",
	ENCRYPTION_KEY: "0".repeat(64),
	GITHUB_OAUTH_CLIENT_ID: "gh-id",
	GITHUB_OAUTH_CLIENT_SECRET: "gh-secret",
	GITHUB_OAUTH_REDIRECT_URI: "https://example.com/oauth/github/callback",
	JIRA_OAUTH_CLIENT_ID: "jira-id",
	JIRA_OAUTH_CLIENT_SECRET: "jira-secret",
	JIRA_OAUTH_REDIRECT_URI: "https://example.com/oauth/jira/callback",
}

describe("loadServerEnv — production safety guards", () => {
	it("throws when NODE_ENV=production and STRIPE_WEBHOOK_SECRET is missing", () => {
		expect(() => loadServerEnv({ ...baseEnv, NODE_ENV: "production" })).toThrowError(
			/STRIPE_WEBHOOK_SECRET.*required.*production/i,
		)
	})

	it("throws when NODE_ENV=production and STRIPE_WEBHOOK_SECRET is empty", () => {
		expect(() =>
			loadServerEnv({ ...baseEnv, NODE_ENV: "production", STRIPE_WEBHOOK_SECRET: "" }),
		).toThrowError(/STRIPE_WEBHOOK_SECRET.*required.*production/i)
	})

	it("accepts NODE_ENV=production when STRIPE_WEBHOOK_SECRET is set", () => {
		expect(() =>
			loadServerEnv({
				...baseEnv,
				NODE_ENV: "production",
				STRIPE_WEBHOOK_SECRET: "whsec_real_value",
			}),
		).not.toThrow()
	})

	it("accepts NODE_ENV=development without STRIPE_WEBHOOK_SECRET", () => {
		expect(() => loadServerEnv({ ...baseEnv, NODE_ENV: "development" })).not.toThrow()
	})

	it("accepts NODE_ENV=test without STRIPE_WEBHOOK_SECRET", () => {
		expect(() => loadServerEnv({ ...baseEnv, NODE_ENV: "test" })).not.toThrow()
	})
})
