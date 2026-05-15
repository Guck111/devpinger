import { sql } from "drizzle-orm"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { db } from "../db.js"
import { redisConnection } from "../queues.js"

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
	Promise.race([
		promise,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
	])

const checkDb = async (): Promise<boolean> => {
	try {
		await withTimeout(db.execute(sql`SELECT 1`), 1000)
		return true
	} catch {
		return false
	}
}

const checkRedis = async (): Promise<boolean> => {
	try {
		const result = await withTimeout(redisConnection.ping(), 1000)
		return result === "PONG"
	} catch {
		return false
	}
}

export const healthRoutes = async (app: FastifyInstance) => {
	const handler = async (_req: FastifyRequest, reply: FastifyReply) => {
		const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()])
		const ok = dbOk && redisOk
		reply.code(ok ? 200 : 503).send({
			status: ok ? "ok" : "degraded",
			db: dbOk ? "ok" : "fail",
			redis: redisOk ? "ok" : "fail",
			ts: new Date().toISOString(),
		})
	}
	app.get("/health", handler)
	app.get("/ready", handler)
}
