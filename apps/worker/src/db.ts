import { createDatabase } from "@devpinger/db"
import { env } from "./config.js"

export const db = createDatabase(env.DATABASE_URL, { poolSize: env.DATABASE_POOL_SIZE })
