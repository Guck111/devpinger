import type { FastifyInstance } from "fastify"

export const healthRoutes = async (app: FastifyInstance) => {
	app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }))
	app.get("/ready", async () => ({ status: "ready" }))
}
