import { events as eventsTable, subscriptions as subsTable } from "@devpinger/db"
import { count, eq, max } from "drizzle-orm"
import type { CommandContext } from "grammy"
import { env } from "../config.js"
import { db } from "../db.js"
import { logger } from "../logger.js"
import { notificationsQueue, snoozeQueue } from "../queues.js"
import type { BotContext } from "./index.js"

const formatUptime = (seconds: number): string => {
	const d = Math.floor(seconds / 86400)
	const h = Math.floor((seconds % 86400) / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)
	const parts: string[] = []
	if (d) parts.push(`${d}d`)
	if (h) parts.push(`${h}h`)
	if (m) parts.push(`${m}m`)
	parts.push(`${s}s`)
	return parts.join(" ")
}

export const handleStatusCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId || telegramId !== env.ADMIN_TELEGRAM_ID) return

	try {
		const [notifCounts, snoozeCounts, lastDeliveredRows, activeSubsRows] = await Promise.all([
			notificationsQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
			snoozeQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
			db.select({ ts: max(eventsTable.deliveredAt) }).from(eventsTable),
			db.select({ n: count() }).from(subsTable).where(eq(subsTable.isActive, true)),
		])
		const lastDelivered = lastDeliveredRows[0]?.ts ?? null
		const activeSubs = Number(activeSubsRows[0]?.n ?? 0)

		const uptime = formatUptime(process.uptime())
		const lastDeliveredText = lastDelivered
			? `${new Date(lastDelivered).toISOString()} (${Math.round(
					(Date.now() - new Date(lastDelivered).getTime()) / 1000,
				)}s ago)`
			: "—"

		const lines = [
			"🩺 <b>DevPinger status</b>",
			"",
			"<b>notifications queue</b>",
			`  waiting:   ${notifCounts.waiting}`,
			`  active:    ${notifCounts.active}`,
			`  delayed:   ${notifCounts.delayed}`,
			`  failed:    ${notifCounts.failed}`,
			`  completed: ${notifCounts.completed}`,
			"",
			"<b>snooze queue</b>",
			`  waiting:   ${snoozeCounts.waiting}`,
			`  active:    ${snoozeCounts.active}`,
			`  delayed:   ${snoozeCounts.delayed}`,
			`  failed:    ${snoozeCounts.failed}`,
			`  completed: ${snoozeCounts.completed}`,
			"",
			`<b>active subscriptions</b>: ${activeSubs}`,
			`<b>last delivered</b>: ${lastDeliveredText}`,
			`<b>uptime</b>: ${uptime}`,
		]
		await ctx.reply(lines.join("\n"), { parse_mode: "HTML" })
	} catch (err) {
		logger.error({ err }, "/status failed")
		await ctx.reply("status unavailable")
	}
}
