import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { webhookCallback } from "grammy"
import { bot } from "../bot/index.js"
import { env } from "../config.js"

type FastifyWebhookHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>

let handle: FastifyWebhookHandler | null = null
const getHandle = (): FastifyWebhookHandler => {
	if (!handle) {
		handle = webhookCallback(bot, "fastify", {
			secretToken: env.TELEGRAM_WEBHOOK_SECRET,
		}) as FastifyWebhookHandler
	}
	return handle
}

export const telegramRoutes = async (app: FastifyInstance) => {
	app.post("/telegram/webhook", async (req, reply) => {
		await getHandle()(req, reply)
	})
}
