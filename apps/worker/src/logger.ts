import pino from "pino"
import { env } from "./config.js"

const level =
	env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "production" ? "info" : env.LOG_LEVEL

export const logger = pino({
	level,
	name: "devpinger-worker",
	base: { service: "worker", env: env.NODE_ENV },
	transport:
		env.NODE_ENV === "development"
			? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
			: undefined,
})
