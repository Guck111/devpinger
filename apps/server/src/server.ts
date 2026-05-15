import type { DestinationAdapter, PlanGate, SourceAdapter } from "@devpinger/core"
import { noopPlanGate } from "@devpinger/core"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { logger } from "./logger.js"
import { destinationRegistry, sourceRegistry } from "./registries.js"
import { healthRoutes } from "./routes/health.js"
import { githubOauthRoutes } from "./routes/oauth/github.js"
import { jiraOauthRoutes } from "./routes/oauth/jira.js"
import { telegramRoutes } from "./routes/telegram.js"
import { githubWebhookRoutes } from "./routes/webhooks/github.js"
import { jiraWebhookRoutes } from "./routes/webhooks/jira.js"
import { Sentry, isSentryEnabled } from "./sentry.js"

export interface AppContext {
	planGate: PlanGate
}

export interface AppExtensions {
	registerRoutes?: (app: FastifyInstance, ctx: AppContext) => Promise<void> | void
	planGate?: PlanGate
	sources?: SourceAdapter[]
	destinations?: DestinationAdapter[]
}

export const createApp = async (extensions: AppExtensions = {}) => {
	for (const adapter of extensions.sources ?? []) sourceRegistry.register(adapter)
	for (const adapter of extensions.destinations ?? []) destinationRegistry.register(adapter)

	const ctx: AppContext = {
		planGate: extensions.planGate ?? noopPlanGate,
	}

	const app = Fastify({ loggerInstance: logger, trustProxy: true })

	app.addContentTypeParser(
		"application/json",
		{ parseAs: "string" },
		(req: FastifyRequest, body, done) => {
			;(req as FastifyRequest & { rawBody?: string }).rawBody = body as string
			try {
				done(null, body === "" ? {} : JSON.parse(body as string))
			} catch (err) {
				done(err as Error, undefined)
			}
		},
	)

	if (isSentryEnabled()) {
		Sentry.setupFastifyErrorHandler(app)
	}

	await app.register(helmet, { contentSecurityPolicy: false })
	await app.register(cors, { origin: false })
	await app.register(rateLimit, { max: 600, timeWindow: "1 minute" })

	await app.register(healthRoutes)
	await app.register(telegramRoutes)
	await app.register(githubOauthRoutes)
	await app.register(jiraOauthRoutes)
	await app.register(githubWebhookRoutes)
	await app.register(jiraWebhookRoutes)

	if (extensions.registerRoutes) {
		await extensions.registerRoutes(app as unknown as FastifyInstance, ctx)
	}

	return app
}
