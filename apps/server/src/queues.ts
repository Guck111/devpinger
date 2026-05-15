import { Queue } from "bullmq"
import { Redis } from "ioredis"
import { env } from "./config.js"
import type { SnoozeJobData } from "./services/snooze-enqueue.js"

export const redisConnection = new Redis(env.REDIS_URL, {
	maxRetriesPerRequest: null,
	enableReadyCheck: true,
	lazyConnect: true,
})

export const notificationsQueue = new Queue("notifications", { connection: redisConnection })
export const snoozeQueue = new Queue<SnoozeJobData>("snooze", { connection: redisConnection })
