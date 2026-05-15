import type { FastifyInstance, FastifyRequest } from "fastify"
import { db } from "../../db.js"
import { logger } from "../../logger.js"
import { sourceRegistry } from "../../registries.js"
import { ingestWebhook } from "../../services/ingest.js"

interface RawBodyRequest extends FastifyRequest {
	rawBody?: string
}

export const githubWebhookRoutes = async (app: FastifyInstance) => {
	app.post("/webhooks/github", async (req: RawBodyRequest, reply) => {
		const rawBody = req.rawBody ?? ""
		const adapter = sourceRegistry.require("github")
		try {
			const ingested = await ingestWebhook(db, {
				provider: "github",
				adapter,
				headers: req.headers,
				rawBody,
				parsedBody: req.body,
			})
			return reply.code(200).send({ accepted: ingested.length })
		} catch (err) {
			logger.error({ err }, "github webhook ingest failed")
			return reply.code(500).send({ error: "ingest failed" })
		}
	})
}
