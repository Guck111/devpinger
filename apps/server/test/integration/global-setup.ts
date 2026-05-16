import path from "node:path"
import { fileURLToPath } from "node:url"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import nock from "nock"
import postgres from "postgres"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.resolve(__dirname, "../../../../packages/db/drizzle")

let pgContainer: StartedPostgreSqlContainer | undefined
let redisContainer: StartedRedisContainer | undefined

const seedStubEnv = (): void => {
	process.env.PUBLIC_BASE_URL ??= "http://localhost:3001"
	process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub"
	process.env.REDIS_URL ??= "redis://localhost:6379"
	process.env.TELEGRAM_BOT_TOKEN ??= "test:telegram-bot-token"
	process.env.TELEGRAM_BOT_USERNAME ??= "devpinger_test_bot"
	process.env.TELEGRAM_WEBHOOK_SECRET ??= "test-webhook-secret-1234567890"
	process.env.ENCRYPTION_KEY ??= "0".repeat(64)
	process.env.GITHUB_OAUTH_CLIENT_ID ??= "test-github-id"
	process.env.GITHUB_OAUTH_CLIENT_SECRET ??= "test-github-secret"
	process.env.GITHUB_OAUTH_REDIRECT_URI ??= "http://localhost:3001/oauth/github/callback"
	process.env.GITHUB_WEBHOOK_SECRET_SEED ??= "test-github-webhook-secret-seed-1234567890abcdef"
	process.env.JIRA_OAUTH_CLIENT_ID ??= "test-jira-id"
	process.env.JIRA_OAUTH_CLIENT_SECRET ??= "test-jira-secret"
	process.env.JIRA_OAUTH_REDIRECT_URI ??= "http://localhost:3001/oauth/jira/callback"
	process.env.LOG_LEVEL ??= "warn"
}

const applyMigrations = async (databaseUrl: string): Promise<void> => {
	const sql = postgres(databaseUrl, { max: 1, prepare: false })
	const db = drizzle(sql)
	try {
		await migrate(db, { migrationsFolder })
	} finally {
		await sql.end()
	}
}

const enableHermeticNetwork = (): void => {
	nock.disableNetConnect()
	nock.enableNetConnect(
		(host) =>
			host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0"),
	)
}

export const setup = async (): Promise<void> => {
	seedStubEnv()

	// If the env already provides INTEGRATION_DB_URL + INTEGRATION_REDIS_URL
	// (CI services, local docker compose), reuse them — no need for testcontainers.
	const presetDbUrl = process.env.INTEGRATION_DB_URL
	const presetRedisUrl = process.env.INTEGRATION_REDIS_URL
	if (presetDbUrl && presetRedisUrl) {
		await applyMigrations(presetDbUrl)
		process.env.DATABASE_URL = presetDbUrl
		process.env.REDIS_URL = presetRedisUrl
		enableHermeticNetwork()
		return
	}

	try {
		pgContainer = await new PostgreSqlContainer("postgres:16-alpine")
			.withDatabase("devpinger_test")
			.withUsername("devpinger")
			.withPassword("devpinger")
			.start()
		redisContainer = await new RedisContainer("redis:7-alpine").start()
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		// eslint-disable-next-line no-console
		console.warn(`[integration] Skipping testcontainers (docker unavailable): ${message}`)
		return
	}

	const databaseUrl = pgContainer.getConnectionUri()
	const redisUrl = redisContainer.getConnectionUrl()

	await applyMigrations(databaseUrl)

	process.env.INTEGRATION_DB_URL = databaseUrl
	process.env.INTEGRATION_REDIS_URL = redisUrl
	process.env.DATABASE_URL = databaseUrl
	process.env.REDIS_URL = redisUrl

	enableHermeticNetwork()
}

export const teardown = async (): Promise<void> => {
	nock.cleanAll()
	nock.enableNetConnect()
	await Promise.allSettled([pgContainer?.stop(), redisContainer?.stop()])
}
