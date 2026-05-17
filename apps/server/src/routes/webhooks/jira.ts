import { timingSafeEqual } from "node:crypto"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { db } from "../../db.js"
import { logger } from "../../logger.js"
import { sourceRegistry } from "../../registries.js"
import { findConnectionById } from "../../services/connections.js"
import { ingestWebhook } from "../../services/ingest.js"
import { findSubscriptionById, listSubscriptions } from "../../services/subscriptions.js"

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

const projectKeyFromPayload = (body: unknown): string | null => {
	if (typeof body !== "object" || body === null) return null
	const issue = (body as { issue?: unknown }).issue
	if (typeof issue !== "object" || issue === null) return null
	const fields = (issue as { fields?: unknown }).fields
	if (typeof fields !== "object" || fields === null) return null
	const project = (fields as { project?: unknown }).project
	if (typeof project !== "object" || project === null) return null
	const key = (project as { key?: unknown }).key
	return typeof key === "string" ? key : null
}

// Both flows below produce { subscriptionId, headers } that are passed into
// ingestWebhook. Splitting keeps the route handler readable.
interface ResolvedJiraWebhook {
	subscriptionId: string
}

export const jiraWebhookRoutes = async (app: FastifyInstance) => {
	// `:id` is interpreted first as a connection id (current flow — one
	// aggregate webhook per user/cloudId registered automatically) and
	// falls back to a subscription id (legacy URLs registered manually
	// before automatic registration shipped; kept temporarily for migration).
	app.post<{ Params: { id: string } }>("/webhooks/jira/:id", async (req: RawBodyRequest, reply) => {
		const { id } = req.params as { id: string }
		const rawBody = req.rawBody ?? ""
		const childLog = logger.child({ webhook: "jira", id })

		const providedSecret = secretFromRequest(req)
		let resolved: ResolvedJiraWebhook | null = null

		// 1. Connection-id flow.
		const connection = await findConnectionById(db, id).catch(() => null)
		const meta = connection?.provider === "jira" ? connection.credentials.jiraWebhook : undefined
		if (connection && connection.provider === "jira" && meta) {
			if (!constantTimeStringEqual(providedSecret, meta.secret)) {
				childLog.warn("jira webhook: invalid secret (connection flow)")
				return reply.code(401).send({ error: "invalid secret" })
			}
			const projectKey = projectKeyFromPayload(req.body)
			if (!projectKey) {
				childLog.info("jira webhook: payload has no project key")
				return reply.code(200).send({ accepted: 0 })
			}
			const subs = await listSubscriptions(db, connection.userId, "jira")
			const sub = subs.find((s) => s.isActive && s.providerScopeId === projectKey)
			if (!sub) {
				childLog.info({ projectKey }, "jira webhook: no active subscription for project key")
				return reply.code(200).send({ accepted: 0 })
			}
			resolved = { subscriptionId: sub.id }
		} else {
			// 2. Legacy subscription-id flow.
			const subscription = await findSubscriptionById(db, id).catch(() => null)
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
			if (!constantTimeStringEqual(providedSecret, subscription.webhookSecret ?? "")) {
				childLog.warn("jira webhook: invalid or missing secret (legacy flow)")
				return reply.code(401).send({ error: "invalid secret" })
			}
			resolved = { subscriptionId: subscription.id }
		}

		const adapter = sourceRegistry.require("jira")
		const headers = {
			...req.headers,
			"x-devpinger-subscription-id": resolved.subscriptionId,
		}
		try {
			const ingested = await ingestWebhook(db, {
				provider: "jira",
				adapter,
				headers,
				rawBody,
				parsedBody: req.body,
				deliveryId: resolved.subscriptionId,
			})
			childLog.info(
				{
					accepted: ingested.length,
					muted: ingested.filter((i) => i.muted).length,
					subscriptionId: resolved.subscriptionId,
				},
				"jira webhook processed",
			)
			return reply.code(200).send({ accepted: ingested.length })
		} catch (err) {
			childLog.error({ err }, "jira webhook ingest failed")
			return reply.code(500).send({ error: "ingest failed" })
		}
	})
}
