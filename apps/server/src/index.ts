import { registerBotCommands } from "./bot/commands-menu.js"
import { bot } from "./bot/index.js"
import { registerBotMetadata } from "./bot/metadata.js"
import { env } from "./config.js"
import { logger } from "./logger.js"
import { captureError, initSentry } from "./sentry.js"
import { createApp } from "./server.js"

initSentry()

process.on("unhandledRejection", (reason) => {
	logger.error({ reason }, "unhandled rejection")
	captureError(reason)
})

process.on("uncaughtException", (err) => {
	logger.error({ err }, "uncaught exception")
	captureError(err)
})

const main = async () => {
	const app = await createApp()

	try {
		await registerBotCommands(bot.api)
	} catch (err) {
		logger.warn({ err }, "failed to publish bot command menu")
	}

	try {
		await registerBotMetadata(bot.api)
	} catch (err) {
		logger.warn({ err }, "failed to publish bot description")
	}

	const shouldUseWebhook = env.NODE_ENV === "production"
	if (!shouldUseWebhook) {
		await bot.api.deleteWebhook({ drop_pending_updates: true })
		logger.info("Starting Telegram bot in long-polling mode (development)")
		void bot.start({ drop_pending_updates: true })
	} else {
		const webhookUrl = `${env.PUBLIC_BASE_URL}/telegram/webhook`
		await bot.api.setWebhook(webhookUrl, { secret_token: env.TELEGRAM_WEBHOOK_SECRET })
		logger.info({ webhookUrl }, "Telegram webhook registered")
	}

	await app.listen({ host: "0.0.0.0", port: env.PORT })

	let shuttingDown = false
	const shutdown = async (signal: string) => {
		if (shuttingDown) return
		shuttingDown = true
		logger.info({ signal }, "shutting down")
		const force = setTimeout(() => {
			logger.warn("shutdown timeout exceeded, forcing exit")
			process.exit(1)
		}, 10_000)
		force.unref()
		try {
			await bot.stop()
			await app.close()
			clearTimeout(force)
			process.exit(0)
		} catch (err) {
			logger.error({ err }, "error during shutdown")
			process.exit(1)
		}
	}
	process.on("SIGINT", () => void shutdown("SIGINT"))
	process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

main().catch((err) => {
	logger.error({ err }, "fatal startup error")
	process.exit(1)
})
