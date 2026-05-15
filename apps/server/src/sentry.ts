import { redact, redactObject } from "@devpinger/shared"
import * as Sentry from "@sentry/node"
import { env } from "./config.js"
import { logger } from "./logger.js"

let initialised = false

export const initSentry = (): void => {
	if (initialised) return
	if (!env.SENTRY_DSN) {
		logger.info("Sentry DSN not set — error reporting disabled")
		return
	}
	Sentry.init({
		dsn: env.SENTRY_DSN,
		environment: env.NODE_ENV,
		tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
		serverName: "devpinger-server",
	})
	initialised = true
	logger.info({ environment: env.NODE_ENV }, "Sentry initialised")
}

export const captureError = (err: unknown, context?: Record<string, unknown>): void => {
	if (!initialised) return
	const safeContext = redactObject(context)
	const safeErr = err instanceof Error ? new Error(String(redact(err.message))) : err
	if (err instanceof Error && safeErr instanceof Error && err.stack) {
		safeErr.stack = String(redact(err.stack))
		safeErr.name = err.name
	}
	Sentry.withScope((scope) => {
		if (safeContext) scope.setContext("extra", safeContext)
		Sentry.captureException(safeErr)
	})
}

export { Sentry }
