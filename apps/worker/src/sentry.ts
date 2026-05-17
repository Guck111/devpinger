import { redact, redactObject } from "@devpinger/shared"
import * as Sentry from "@sentry/node"
import { env } from "./config.js"
import { logger } from "./logger.js"

let initialised = false

// Drop fields that can carry webhook payloads / PII before the event leaves
// the process. The worker doesn't see HTTP requests, but BullMQ job data
// frequently lands in event.extra; strip body/payload entries defensively.
const stripUntrustedFields = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
	if (event.extra) {
		delete event.extra.body
		delete event.extra.rawBody
		delete event.extra.payload
	}
	if (event.breadcrumbs) {
		for (const b of event.breadcrumbs) {
			if (b.data) {
				delete b.data.body
				delete b.data.payload
				if (typeof b.data.url === "string") b.data.url = String(redact(b.data.url))
			}
		}
	}
	return event
}

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
		serverName: "devpinger-worker",
		sendDefaultPii: false,
		beforeSend: stripUntrustedFields,
	})
	initialised = true
	logger.info({ environment: env.NODE_ENV }, "Sentry initialised")
}

export const isSentryEnabled = (): boolean => initialised

export const addBreadcrumb = (breadcrumb: Sentry.Breadcrumb): void => {
	if (!initialised) return
	Sentry.addBreadcrumb(breadcrumb)
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
