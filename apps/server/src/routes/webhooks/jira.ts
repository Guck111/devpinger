import type { FastifyInstance, FastifyRequest } from "fastify"
import { db } from "../../db.js"
import { logger } from "../../logger.js"
import { sourceRegistry } from "../../registries.js"
import { ingestWebhook } from "../../services/ingest.js"

interface RawBodyRequest extends FastifyRequest {
	rawBody?: string
}

export const jiraWebhookRoutes = async (app: FastifyInstance) => {
	app.post<{ Params: { subscriptionId: string } }>(
		"/webhooks/jira/:subscriptionId",
		async (req: RawBodyRequest, reply) => {
			const { subscriptionId } = req.params as { subscriptionId: string }
			const rawBody = req.rawBody ?? ""
			const adapter = sourceRegistry.require("jira")
			// Mirror the subscription id into a header so the adapter's
			// verifyAndNormalize can read it without a path-aware shim.
			const headers = {
				...req.headers,
				"x-devpinger-subscription-id": subscriptionId,
			}
			try {
				const ingested = await ingestWebhook(db, {
					provider: "jira",
					adapter,
					headers,
					rawBody,
					parsedBody: req.body,
				})
				return reply.code(200).send({ accepted: ingested.length })
			} catch (err) {
				logger.error({ err, subscriptionId }, "jira webhook ingest failed")
				return reply.code(500).send({ error: "ingest failed" })
			}
		},
	)
}
