import { landingSubscribers, preorders } from "@devpinger/db"
import { eq, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { env } from "../config.js"
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
				logger.info(
					{ email: parsed.data.email, source: parsed.data.source },
					"landing.subscribe.ok",
				)
				return reply.code(200).send({ ok: true })
			} catch (err) {
				logger.error({ err }, "landing.subscribe.error")
				return reply.code(500).send({ ok: false, error: "internal error" })
			}
		},
	)

	app.get(
		"/v1/landing/seats",
		{
			config: {
				rateLimit: { max: 120, timeWindow: "1 minute" },
			},
		},
		async (_req, reply) => {
			try {
				const rows = await db
					.select({ count: sql<number>`count(*)::int` })
					.from(preorders)
					.where(eq(preorders.status, "paid"))
				const sold = rows[0]?.count ?? 0
				const total = env.PREORDER_TOTAL_SEATS
				// Short cache to avoid hammering the DB from the public landing while
				// still reflecting new sales within a minute.
				reply.header("cache-control", "public, max-age=60")
				return reply.code(200).send({ sold, total })
			} catch (err) {
				logger.error({ err }, "landing.seats.error")
				return reply.code(500).send({ ok: false, error: "internal error" })
			}
		},
	)
}
