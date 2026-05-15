import "dotenv/config"
import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env.DATABASE_URL ?? "postgres://noop:noop@localhost:5432/noop"

export default defineConfig({
	schema: "./dist/schema/index.js",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: { url: databaseUrl },
	verbose: true,
	strict: true,
})
