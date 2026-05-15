import { randomBytes } from "node:crypto"
import { oauthStates } from "@devpinger/db"
import { and, eq, lt } from "drizzle-orm"
import type { db as Db } from "../db.js"

export type OauthProvider = "github" | "jira"

export interface OauthStateRecord {
	state: string
	userId: string
	provider: OauthProvider
	codeVerifier: string | null
	createdAt: Date
}

const TTL_MS = 10 * 60 * 1000

export const createOauthState = async (
	db: typeof Db,
	input: { userId: string; provider: OauthProvider; codeVerifier?: string },
): Promise<string> => {
	const state = randomBytes(24).toString("base64url")
	await db.insert(oauthStates).values({
		state,
		userId: input.userId,
		provider: input.provider,
		codeVerifier: input.codeVerifier ?? null,
	})
	return state
}

export const consumeOauthState = async (
	db: typeof Db,
	state: string,
): Promise<OauthStateRecord | null> => {
	const rows = await db.delete(oauthStates).where(eq(oauthStates.state, state)).returning()
	const row = rows[0]
	if (!row) return null
	const ageMs = Date.now() - row.createdAt.getTime()
	if (ageMs > TTL_MS) return null
	return {
		state: row.state,
		userId: row.userId,
		provider: row.provider as OauthProvider,
		codeVerifier: row.codeVerifier,
		createdAt: row.createdAt,
	}
}

export const purgeExpiredOauthStates = async (db: typeof Db): Promise<number> => {
	const cutoff = new Date(Date.now() - TTL_MS)
	const rows = await db.delete(oauthStates).where(lt(oauthStates.createdAt, cutoff)).returning({
		state: oauthStates.state,
	})
	return rows.length
}

export const peekOauthState = async (
	db: typeof Db,
	state: string,
	provider: OauthProvider,
): Promise<OauthStateRecord | null> => {
	const rows = await db
		.select()
		.from(oauthStates)
		.where(and(eq(oauthStates.state, state), eq(oauthStates.provider, provider)))
		.limit(1)
	const row = rows[0]
	if (!row) return null
	return {
		state: row.state,
		userId: row.userId,
		provider: row.provider as OauthProvider,
		codeVerifier: row.codeVerifier,
		createdAt: row.createdAt,
	}
}
