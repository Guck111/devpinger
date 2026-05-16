import { timingSafeEqual } from "node:crypto"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { db } from "../../db.js"
import { logger } from "../../logger.js"
import { sourceRegistry } from "../../registries.js"
import { ingestWebhook } from "../../services/ingest.js"
import { findSubscriptionById } from "../../services/subscriptions.js"

interface RawBodyRequest extends FastifyRequest {
	rawBody?: string
}

const secretFromRequest = (req: FastifyRequest): string => {
	const fromQuery = (req.query as { secret?: string } | undefined)?.secret
	if (typeof fromQuery === "string") return fromQuery
	const fromHeader = req.headers["x-devping-webhook-secret"]
	if (typeof fromHeader === "string") return fromHeader
	if (Array.isArray(fromHeader) && typeof fromHeader[0] === "string") return fromHeader[0]
	return ""
}

const constantTimeStringEqual = (a: string, b: string): boolean => {
	const aBuf = Buffer.from(a, "utf8")
	const bBuf = Buffer.from(b, "utf8")
	if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false
	return timingSafeEqual(aBuf, bBuf)
}

export const jiraWebhookRoutes = async (app: FastifyInstance) => {
	app.post<{ Params: { subscriptionId: string } }>(
		"/webhooks/jira/:subscriptionId",
		async (req: RawBodyRequest, reply) => {
			const { subscriptionId } = req.params as { subscriptionId: string }
			const rawBody = req.rawBody ?? ""
			const childLog = logger.child({ webhook: "jira", subscriptionId })

			const subscription = await findSubscriptionById(db, subscriptionId).catch(() => null)
			if (!subscription || subscription.provider !== "jira" || !subscription.isActive) {
				childLog.warn(
					{
						found: Boolean(subscription),
						provider: subscription?.provider,
						isActive: subscription?.isActive,
					},
					"jira webhook: subscription not found",
				)
				return reply.code(404).send({ error: "subscription not found" })
			}
			const providedSecret = secretFromRequest(req)
			const expectedSecret = subscription.webhookSecret ?? ""
			if (!constantTimeStringEqual(providedSecret, expectedSecret)) {
				childLog.warn("jira webhook: invalid or missing secret")
				return reply.code(401).send({ error: "invalid secret" })
			}

			const adapter = sourceRegistry.require("jira")
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
					deliveryId: subscriptionId,
				})
				childLog.info(
					{
						accepted: ingested.length,
						muted: ingested.filter((i) => i.muted).length,
					},
					"jira webhook processed",
				)
				return reply.code(200).send({ accepted: ingested.length })
			} catch (err) {
				childLog.error({ err }, "jira webhook ingest failed")
				return reply.code(500).send({ error: "ingest failed" })
			}
		},
	)
}
