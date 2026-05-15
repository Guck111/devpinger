import path from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadDotenv } from "dotenv"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: path.resolve(__dirname, "../../../.env") })

const main = async () => {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required to run migrations")
	}
	const sql = postgres(databaseUrl, { max: 1, prepare: false })
	const db = drizzle(sql)
	console.log("Running migrations...")
	await migrate(db, { migrationsFolder: "./drizzle" })
	console.log("Migrations complete")
	await sql.end()
}

main().catch((err) => {
	console.error("Migration failed:", err)
	process.exit(1)
})
