import type { Locale } from "@devpinger/i18n"
import type { Queue } from "bullmq"

export interface SnoozeJobData {
	eventId: string
	userId: string
	telegramChatId: number
	locale: Locale
}

// BullMQ 5.x rejects `:` in custom job IDs (reserved for internal Redis
// key separators). Stick to a `-` separator.
export const snoozeJobId = (eventId: string): string => `snooze-${eventId}`

// A second snooze on the same event (e.g. 1h → 4h) used to leave the
// first wake job in Redis. Both fired, the second one re-cleared
// telegramMessageId and notifications.deliver shipped the same message
// twice. Tag every wake with a per-event jobId and drop the stale one
// before scheduling the new one so only the latest snooze fires.
export const enqueueSnoozeWake = async (
	queue: Queue<SnoozeJobData>,
	data: SnoozeJobData,
	delayMs: number,
): Promise<void> => {
	const jobId = snoozeJobId(data.eventId)
	const existing = await queue.getJob(jobId)
	if (existing) {
		try {
			await existing.remove()
		} catch {
			// Job already drained between getJob and remove — fine.
		}
	}
	await queue.add("wake", data, {
		jobId,
		delay: delayMs,
		removeOnComplete: 1000,
		removeOnFail: 100,
	})
}
