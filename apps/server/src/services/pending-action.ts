import type { Redis } from "ioredis"

export type PendingActionKind = "comment"

export interface PendingCommentAction {
	kind: "comment"
	eventId: string
	expiresAt: number
}

export type PendingAction = PendingCommentAction

const KEY_PREFIX = "pending:"
const TTL_SECONDS = 300

const buildKey = (telegramId: number): string => `${KEY_PREFIX}${telegramId}`

export const setPendingAction = async (
	redis: Redis,
	telegramId: number,
	action: PendingAction,
): Promise<void> => {
	await redis.set(buildKey(telegramId), JSON.stringify(action), "EX", TTL_SECONDS)
}

export const getPendingAction = async (
	redis: Redis,
	telegramId: number,
): Promise<PendingAction | null> => {
	const raw = await redis.get(buildKey(telegramId))
	if (!raw) return null
	try {
		return JSON.parse(raw) as PendingAction
	} catch {
		return null
	}
}

export const clearPendingAction = async (redis: Redis, telegramId: number): Promise<void> => {
	await redis.del(buildKey(telegramId))
}
