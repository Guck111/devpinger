import { subscriptions } from "@devpinger/db"
import { and, eq } from "drizzle-orm"
import type { db as Db } from "../db.js"
import type { OauthProvider } from "./oauth-state.js"

export interface SubscriptionRow {
	id: string
	userId: string
	provider: OauthProvider
	providerScopeId: string
	displayName: string
	webhookId: string | null
	webhookSecret: string | null
	isActive: boolean
}

const toSubscriptionRow = (row: {
	id: string
	userId: string
	provider: string
	providerScopeId: string
	displayName: string
	webhookId: string | null
	webhookSecret: string | null
	isActive: boolean
}): SubscriptionRow => ({
	id: row.id,
	userId: row.userId,
	provider: row.provider as OauthProvider,
	providerScopeId: row.providerScopeId,
	displayName: row.displayName,
	webhookId: row.webhookId,
	webhookSecret: row.webhookSecret,
	isActive: row.isActive,
})

export interface CreateSubscriptionInput {
	userId: string
	provider: OauthProvider
	providerScopeId: string
	displayName: string
	webhookId?: string | null
	webhookSecret?: string | null
}

export const createSubscription = async (
	db: typeof Db,
	input: CreateSubscriptionInput,
): Promise<SubscriptionRow> => {
	const [row] = await db
		.insert(subscriptions)
		.values({
			userId: input.userId,
			provider: input.provider,
			providerScopeId: input.providerScopeId,
			displayName: input.displayName,
			webhookId: input.webhookId ?? null,
			webhookSecret: input.webhookSecret ?? null,
			isActive: true,
		})
		.onConflictDoUpdate({
			target: [subscriptions.userId, subscriptions.provider, subscriptions.providerScopeId],
			set: {
				displayName: input.displayName,
				webhookId: input.webhookId ?? null,
				webhookSecret: input.webhookSecret ?? null,
				isActive: true,
			},
		})
		.returning()
	if (!row) throw new Error("createSubscription returned no rows")
	return toSubscriptionRow(row)
}

export const listSubscriptions = async (
	db: typeof Db,
	userId: string,
	provider?: OauthProvider,
): Promise<SubscriptionRow[]> => {
	const where = provider
		? and(eq(subscriptions.userId, userId), eq(subscriptions.provider, provider))
		: eq(subscriptions.userId, userId)
	const rows = await db.select().from(subscriptions).where(where)
	return rows.map(toSubscriptionRow)
}

export const findActiveSubscriptionsByProvider = async (
	db: typeof Db,
	provider: OauthProvider,
): Promise<SubscriptionRow[]> => {
	const rows = await db
		.select()
		.from(subscriptions)
		.where(and(eq(subscriptions.provider, provider), eq(subscriptions.isActive, true)))
	return rows.map(toSubscriptionRow)
}

export const findSubscriptionById = async (
	db: typeof Db,
	id: string,
): Promise<SubscriptionRow | null> => {
	const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1)
	return row ? toSubscriptionRow(row) : null
}

export const deactivateSubscription = async (db: typeof Db, id: string): Promise<void> => {
	await db.update(subscriptions).set({ isActive: false }).where(eq(subscriptions.id, id))
}

export const deactivateAllForUser = async (db: typeof Db, userId: string): Promise<number> => {
	const rows = await db
		.update(subscriptions)
		.set({ isActive: false })
		.where(eq(subscriptions.userId, userId))
		.returning({ id: subscriptions.id })
	return rows.length
}

export const deactivateAllForUserProvider = async (
	db: typeof Db,
	userId: string,
	provider: OauthProvider,
): Promise<SubscriptionRow[]> => {
	const rows = await db
		.update(subscriptions)
		.set({ isActive: false })
		.where(
			and(
				eq(subscriptions.userId, userId),
				eq(subscriptions.provider, provider),
				eq(subscriptions.isActive, true),
			),
		)
		.returning()
	return rows.map(toSubscriptionRow)
}
