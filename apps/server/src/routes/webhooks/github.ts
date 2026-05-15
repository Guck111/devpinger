import type { FastifyInstance, FastifyRequest } from "fastify"
import { db } from "../../db.js"
import { logger } from "../../logger.js"
import { sourceRegistry } from "../../registries.js"
import { ingestWebhook } from "../../services/ingest.js"

interface RawBodyRequest extends FastifyRequest {
	rawBody?: string
}

const headerString = (headers: FastifyRequest["headers"], name: string): string | undefined => {
	const value = headers[name]
	if (Array.isArray(value)) return value[0]
	return value
}

export const githubWebhookRoutes = async (app: FastifyInstance) => {
	app.post("/webhooks/github", async (req: RawBodyRequest, reply) => {
		const rawBody = req.rawBody ?? ""
		const deliveryId = headerString(req.headers, "x-github-delivery")
		const eventName = headerString(req.headers, "x-github-event")
		const childLog = logger.child({
			webhook: "github",
			deliveryId,
			eventName,
		})
		const adapter = sourceRegistry.require("github")
		try {
			const ingested = await ingestWebhook(db, {
				provider: "github",
				adapter,
				headers: req.headers,
				rawBody,
				parsedBody: req.body,
			})
			childLog.info(
				{
					accepted: ingested.length,
					muted: ingested.filter((i) => i.muted).length,
				},
				"github webhook processed",
			)
			return reply.code(200).send({ accepted: ingested.length })
		} catch (err) {
			childLog.error({ err }, "github webhook ingest failed")
			return reply.code(500).send({ error: "ingest failed" })
		}
	})
}
