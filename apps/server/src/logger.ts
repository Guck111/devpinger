import pino from "pino"
import { env } from "./config.js"

const level =
	env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "production" ? "info" : env.LOG_LEVEL

// Exported so the redact-test suite can verify against the live config and
// avoid drift between the test and what ships.
export const REDACT_PATHS = [
	"*.webhookSecret",
	"*.accessToken",
	"*.refreshToken",
	"*.encryptedCredentials",
	"*.client_secret",
	"*.token",
	"*.password",
	"*.secret",
	"headers.authorization",
	"headers.cookie",
	"req.headers.authorization",
	"req.headers.cookie",
	"req.headers['x-devping-webhook-secret']",
	// Jira Dynamic Webhooks carry the per-tenant secret as a ?secret=...
	// query parameter because Atlassian doesn't let webhook registrations
	// configure custom request headers. Redact the entire URL to keep that
	// secret out of pino/Fastify request logs.
	"req.url",
	"req.query",
] as const

export const logger = pino({
	level,
	name: "devpinger-server",
	base: { service: "server", env: env.NODE_ENV },
	redact: {
		paths: [...REDACT_PATHS],
		censor: "[REDACTED]",
	},
	transport:
		env.NODE_ENV === "development"
			? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
			: undefined,
})
