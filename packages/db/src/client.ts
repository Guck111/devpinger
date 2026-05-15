import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema/index.js"

export interface CreateDatabaseOptions {
	poolSize?: number
}

export const createDatabase = (connectionString: string, options: CreateDatabaseOptions = {}) => {
	const client = postgres(connectionString, {
		max: options.poolSize ?? 10,
		idle_timeout: 30,
		connect_timeout: 10,
		prepare: false,
	})
	const db = drizzle(client, { schema })
	return Object.assign(db, { $client: client })
}

export type Database = ReturnType<typeof createDatabase>

export { schema }
