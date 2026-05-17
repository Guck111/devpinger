import { redact, redactObject } from "@devpinger/shared"
import * as Sentry from "@sentry/node"
import { env } from "./config.js"
import { logger } from "./logger.js"

let initialised = false

// Drop fields that can carry webhook payloads / PII before the event leaves
// the process. Sentry's fastify integration normally forwards request bodies,
// query strings, and cookies on captured exceptions; for a Jira-webhook ingest
// failure that would smuggle the per-tenant secret (?secret=...) and the
// payload into a third-party service.
const stripUntrustedFields = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
	if (event.request) {
		event.request.data = undefined
		event.request.cookies = undefined
		event.request.query_string = undefined
		if (typeof event.request.url === "string") {
			event.request.url = String(redact(event.request.url))
		}
	}
	if (event.extra) {
		event.extra.body = undefined
		event.extra.rawBody = undefined
		event.extra.payload = undefined
	}
	if (event.breadcrumbs) {
		for (const b of event.breadcrumbs) {
			if (b.data) {
				b.data.body = undefined
				b.data.payload = undefined
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
		serverName: "devpinger-server",
		sendDefaultPii: false,
		integrations: [Sentry.fastifyIntegration()],
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
