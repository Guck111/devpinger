import path from "node:path"
import { fileURLToPath } from "node:url"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.resolve(__dirname, "../../../../packages/db/drizzle")

let pgContainer: StartedPostgreSqlContainer | undefined
let redisContainer: StartedRedisContainer | undefined

export const setup = async (): Promise<void> => {
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

	const sql = postgres(databaseUrl, { max: 1, prepare: false })
	const db = drizzle(sql)
	try {
		await migrate(db, { migrationsFolder })
	} finally {
		await sql.end()
	}

	process.env.INTEGRATION_DB_URL = databaseUrl
	process.env.INTEGRATION_REDIS_URL = redisUrl

	// Stable defaults so loadServerEnv doesn't fail when ingest imports config.
	process.env.DATABASE_URL = databaseUrl
	process.env.REDIS_URL = redisUrl
	process.env.PUBLIC_BASE_URL ??= "http://localhost:3001"
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

export const teardown = async (): Promise<void> => {
	await Promise.allSettled([pgContainer?.stop(), redisContainer?.stop()])
}
