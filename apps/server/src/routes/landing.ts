import { landingSubscribers } from "@devpinger/db"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { db } from "../db.js"
import { logger } from "../logger.js"

const subscribeBodySchema = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
	source: z.string().max(64).optional(),
	// Honeypot: real users never fill hidden fields. Bots typically do.
	hp: z.string().optional(),
})

export const landingRoutes = async (app: FastifyInstance) => {
	app.post(
		"/v1/landing/subscribe",
		{
			config: {
				rateLimit: { max: 5, timeWindow: "1 minute" },
			},
		},
		async (req, reply) => {
			const parsed = subscribeBodySchema.safeParse(req.body)
			if (!parsed.success) {
				return reply.code(400).send({ ok: false, error: "invalid email" })
			}

			// Silently accept honeypot submissions to avoid signalling bot detection.
			if (parsed.data.hp && parsed.data.hp.trim().length > 0) {
				logger.info({ email: parsed.data.email }, "landing.subscribe.honeypot")
				return reply.code(200).send({ ok: true })
			}

			try {
				await db
					.insert(landingSubscribers)
					.values({
						email: parsed.data.email,
						source: parsed.data.source ?? null,
					})
					.onConflictDoNothing({ target: landingSubscribers.email })
				logger.info({ email: parsed.data.email, source: parsed.data.source }, "landing.subscribe.ok")
				return reply.code(200).send({ ok: true })
			} catch (err) {
				logger.error({ err }, "landing.subscribe.error")
				return reply.code(500).send({ ok: false, error: "internal error" })
			}
		},
	)
}
