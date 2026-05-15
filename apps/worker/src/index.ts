import { Redis } from "ioredis"
import { env } from "./config.js"
import { logger } from "./logger.js"
import { startCleanupWorker } from "./queues/cleanup.js"
import { startNotificationsWorker } from "./queues/notifications.js"
import { startOauthStateCleanupWorker } from "./queues/oauth-state-cleanup.js"
import { startSnoozeWorker } from "./queues/snooze.js"
import { captureError, initSentry } from "./sentry.js"

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
	const connection = new Redis(env.REDIS_URL, {
		maxRetriesPerRequest: null,
		enableReadyCheck: true,
	})

	const cleanup = await startCleanupWorker(connection)
	const oauthCleanup = await startOauthStateCleanupWorker(connection)
	const workers = [
		startNotificationsWorker(connection),
		startSnoozeWorker(connection),
		cleanup.worker,
		oauthCleanup.worker,
	]

	logger.info({ count: workers.length }, "workers started")

	const shutdown = async (signal: string) => {
		logger.info({ signal }, "shutting down workers")
		await Promise.all(workers.map((w) => w.close()))
		await cleanup.scheduler.close()
		await oauthCleanup.scheduler.close()
		await connection.quit()
		process.exit(0)
	}

	process.on("SIGINT", () => void shutdown("SIGINT"))
	process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

main().catch((err) => {
	logger.error({ err }, "fatal startup error")
	process.exit(1)
})
