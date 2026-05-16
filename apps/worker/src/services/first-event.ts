import { events, users } from "@devpinger/db"
import { count, eq } from "drizzle-orm"
import type { db as Db } from "../db.js"

export interface MaybeNotifyFirstEventResult {
	shouldSendFollowUp: boolean
}

export const maybeMarkFirstEvent = async (
	db: typeof Db,
	userId: string,
): Promise<MaybeNotifyFirstEventResult> => {
	const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
	if (!userRow) return { shouldSendFollowUp: false }
	if (userRow.firstEventNotifiedAt !== null) return { shouldSendFollowUp: false }
	const [agg] = await db.select({ n: count() }).from(events).where(eq(events.userId, userId))
	const delivered = Number(agg?.n ?? 0)
	if (delivered < 1) return { shouldSendFollowUp: false }
	const result = await db
		.update(users)
		.set({ firstEventNotifiedAt: new Date() })
		.where(eq(users.id, userId))
		.returning({ id: users.id })
	return { shouldSendFollowUp: result.length > 0 }
}
