import { preorders } from "@devpinger/db"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { env } from "../../config.js"
import { db } from "../../db.js"
import { logger } from "../../logger.js"
import { escapeMd, notifyAdmin } from "../../services/admin-notify.js"
import { verifyStripeSignature } from "../../services/stripe-signature.js"

interface RawBodyRequest extends FastifyRequest {
	rawBody?: string
}

const headerString = (headers: FastifyRequest["headers"], name: string): string | undefined => {
	const value = headers[name]
	if (Array.isArray(value)) return value[0]
	return value
}

const customFieldSchema = z.object({
	key: z.string(),
	text: z.object({ value: z.string().nullable().optional() }).optional(),
})

const checkoutSessionCompletedSchema = z.object({
	id: z.string(),
	type: z.literal("checkout.session.completed"),
	created: z.number().int(),
	data: z.object({
		object: z.object({
			id: z.string(),
			object: z.literal("checkout.session"),
			amount_total: z.number().int().nullable(),
			currency: z.string().nullable(),
			payment_status: z.string().optional(),
			customer_details: z
				.object({ email: z.string().email().nullable().optional() })
				.nullable()
				.optional(),
			customer_email: z.string().email().nullable().optional(),
			custom_fields: z.array(customFieldSchema).nullable().optional(),
		}),
	}),
})

const eventEnvelopeSchema = z.object({
	id: z.string(),
	type: z.string(),
})

const extractTelegramUsername = (
	fields: ReadonlyArray<z.infer<typeof customFieldSchema>> | null | undefined,
): string | null => {
	if (!fields) return null
	for (const field of fields) {
		if (/telegram/i.test(field.key)) {
			const raw = field.text?.value?.trim()
			if (!raw) continue
			return raw.replace(/^@/, "")
		}
	}
	return null
}

export const stripeWebhookRoutes = async (app: FastifyInstance) => {
	app.post(
		"/v1/stripe/webhook",
		{
			config: {
				rateLimit: { max: 120, timeWindow: "1 minute" },
			},
		},
		async (req: RawBodyRequest, reply) => {
			const secret = env.STRIPE_WEBHOOK_SECRET
			if (!secret) {
				logger.warn({}, "stripe.webhook.disabled: STRIPE_WEBHOOK_SECRET not set")
				return reply.code(503).send({ ok: false, error: "stripe webhook disabled" })
			}

			const rawBody = req.rawBody ?? ""
			const sigHeader = headerString(req.headers, "stripe-signature")
			const verdict = verifyStripeSignature({ header: sigHeader, rawBody, secret })
			if (!verdict.ok) {
				logger.warn({ reason: verdict.reason }, "stripe.webhook.signature_invalid")
				return reply.code(400).send({ ok: false, error: "invalid signature" })
			}

			const envelope = eventEnvelopeSchema.safeParse(req.body)
			if (!envelope.success) {
				logger.warn({}, "stripe.webhook.envelope_malformed")
				return reply.code(400).send({ ok: false, error: "malformed event" })
			}

			// We only care about checkout.session.completed for the preorder. Acknowledge
			// other event types so Stripe stops retrying them.
			if (envelope.data.type !== "checkout.session.completed") {
				logger.info({ type: envelope.data.type, eventId: envelope.data.id }, "stripe.webhook.ignored")
				return reply.code(200).send({ ok: true, ignored: true })
			}

			const parsed = checkoutSessionCompletedSchema.safeParse(req.body)
			if (!parsed.success) {
				logger.warn(
					{ eventId: envelope.data.id, issues: parsed.error.issues },
					"stripe.webhook.session_payload_invalid",
				)
				return reply.code(400).send({ ok: false, error: "invalid session payload" })
			}

			const session = parsed.data.data.object
			const email = session.customer_details?.email ?? session.customer_email ?? null
			const amountCents = session.amount_total
			const currency = session.currency
			if (!email || amountCents === null || !currency) {
				logger.warn(
					{ eventId: parsed.data.id, hasEmail: !!email, amountCents, currency },
					"stripe.webhook.missing_fields",
				)
				return reply.code(400).send({ ok: false, error: "missing required fields" })
			}

			const telegramUsername = extractTelegramUsername(session.custom_fields ?? null)
			const paidAt = new Date(parsed.data.created * 1000)

			try {
				const inserted = await db
					.insert(preorders)
					.values({
						stripeEventId: parsed.data.id,
						stripeSessionId: session.id,
						email,
						telegramUsername,
						amountCents,
						currency,
						status: "paid",
						paidAt,
					})
					.onConflictDoNothing({ target: preorders.stripeEventId })
					.returning({ id: preorders.id })

				const isNew = inserted.length > 0
				logger.info(
					{
						eventId: parsed.data.id,
						sessionId: session.id,
						email,
						amountCents,
						currency,
						isNew,
					},
					"stripe.webhook.preorder",
				)

				if (isNew) {
					const amount = (amountCents / 100).toFixed(2)
					const tgLine = telegramUsername ? `\nTelegram: @${telegramUsername}` : ""
					await notifyAdmin(
						escapeMd(
							`🎉 New preorder\n${email}\n${amount} ${currency.toUpperCase()}${tgLine}`,
						),
					)
				}

				return reply.code(200).send({ ok: true })
			} catch (err) {
				logger.error({ err, eventId: parsed.data.id }, "stripe.webhook.persist_failed")
				return reply.code(500).send({ ok: false, error: "internal error" })
			}
		},
	)
}
