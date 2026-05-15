import { events, type Event } from "@devpinger/db"
import { eq, sql } from "drizzle-orm"
import type { CallbackQueryContext, Context } from "grammy"
import { InlineKeyboard } from "grammy"
import { db } from "../db.js"
import { formatSnoozeUntil } from "../lib/format-time.js"
import { logger } from "../logger.js"
import { snoozeQueue } from "../queues.js"
import { redisConnection } from "../queues.js"
import { sourceRegistry } from "../registries.js"
import { getConnection } from "../services/connections.js"
import { addMute } from "../services/mutes.js"
import type { OauthProvider } from "../services/oauth-state.js"
import { clearPendingAction, setPendingAction } from "../services/pending-action.js"
import { enqueueSnoozeWake, snoozeJobId } from "../services/snooze-enqueue.js"
import { getUserByTelegramId } from "../services/users.js"
import type { I18nFlavor } from "./i18n.js"

type BotContext = Context & I18nFlavor
type Callback = CallbackQueryContext<BotContext>

const loadEventForUser = async (ctx: Callback, eventId: string): Promise<Event | null> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return null
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return null
	const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1)
	if (!row || row.userId !== user.id) return null
	return row
}

const scopeRefFromEvent = (event: Event): { scope: string } => {
	if (!event.scope) throw new Error(`event ${event.id} has no scope`)
	return { scope: event.scope }
}

const githubActionPayload = (event: Event): Record<string, unknown> => {
	const { scope } = scopeRefFromEvent(event)
	const metadata = (event.metadata as Record<string, unknown>) ?? {}
	const number = metadata.prNumber ?? metadata.issueNumber ?? metadata.number
	return { scope, number }
}

const jiraActionPayload = (event: Event): Record<string, unknown> => {
	const metadata = (event.metadata as Record<string, unknown>) ?? {}
	const issueKey = typeof metadata.issueKey === "string" ? metadata.issueKey : null
	if (!issueKey) throw new Error(`jira event ${event.id} has no issueKey`)
	return { issueIdOrKey: issueKey }
}

const replyAck = async (ctx: Callback, key: string, params: Record<string, unknown> = {}) => {
	await ctx.answerCallbackQuery()
	await ctx.reply(ctx.t(key, params as Record<string, string | number>))
}

const replyError = async (ctx: Callback, key: string, params: Record<string, unknown> = {}) => {
	await ctx.answerCallbackQuery({ text: ctx.t(key, params as Record<string, string | number>) })
}

const runProviderAction = async (
	ctx: Callback,
	event: Event,
	actionName: string,
	payloadExtra: Record<string, unknown> = {},
): Promise<boolean> => {
	const provider = event.source as OauthProvider
	const connection = await getConnection(db, event.userId, provider)
	if (!connection) {
		await replyError(ctx, "errors.reconnect", { provider })
		return false
	}
	const adapter = sourceRegistry.require(provider)
	const action = adapter.actions[actionName]
	if (!action) {
		await replyError(ctx, "errors.notSupported")
		return false
	}
	const basePayload = provider === "github" ? githubActionPayload(event) : jiraActionPayload(event)
	try {
		await action({ type: "oauth", ...connection.credentials }, { ...basePayload, ...payloadExtra })
		return true
	} catch (err) {
		logger.error({ err, eventId: event.id, actionName }, "provider action failed")
		await replyError(ctx, "errors.actionFailed", { reason: String((err as Error).message) })
		return false
	}
}

export const handleApprove = async (ctx: Callback, eventId: string): Promise<void> => {
	const event = await loadEventForUser(ctx, eventId)
	if (!event) {
		await replyError(ctx, "errors.notFound")
		return
	}
	if (event.source !== "github") {
		await replyError(ctx, "errors.notSupported")
		return
	}
	const ok = await runProviderAction(ctx, event, "approve")
	if (ok) await replyAck(ctx, "actionResult.approved")
}

export const handleMerge = async (ctx: Callback, eventId: string): Promise<void> => {
	const event = await loadEventForUser(ctx, eventId)
	if (!event) {
		await replyError(ctx, "errors.notFound")
		return
	}
	if (event.source !== "github") {
		await replyError(ctx, "errors.notSupported")
		return
	}
	const ok = await runProviderAction(ctx, event, "merge", { method: "squash" })
	if (ok) {
		await db
			.update(events)
			.set({ status: "completed", completedAt: sql`now()` })
			.where(eq(events.id, eventId))
		await replyAck(ctx, "actionResult.merged")
	}
}

export const handleClose = async (ctx: Callback, eventId: string): Promise<void> => {
	const event = await loadEventForUser(ctx, eventId)
	if (!event) {
		await replyError(ctx, "errors.notFound")
		return
	}
	if (event.source !== "github") {
		await replyError(ctx, "errors.notSupported")
		return
	}
	const ok = await runProviderAction(ctx, event, "closeIssue")
	if (ok) {
		await db
			.update(events)
			.set({ status: "completed", completedAt: sql`now()` })
			.where(eq(events.id, eventId))
		await replyAck(ctx, "actionResult.closed")
	}
}

export const handleComment = async (ctx: Callback, eventId: string): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const event = await loadEventForUser(ctx, eventId)
	if (!event) {
		await replyError(ctx, "errors.notFound")
		return
	}
	await setPendingAction(redisConnection, telegramId, {
		kind: "comment",
		eventId: event.id,
		expiresAt: Date.now() + 5 * 60 * 1000,
	})
	await ctx.answerCallbackQuery()
	await ctx.reply(ctx.t("actionResult.commentPrompt"))
}

export const submitPendingComment = async (
	ctx: BotContext,
	eventId: string,
	body: string,
): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1)
	if (!event || event.userId !== user.id) {
		await ctx.reply(ctx.t("errors.notFound"))
		return
	}
	const provider = event.source as OauthProvider
	const connection = await getConnection(db, user.id, provider)
	if (!connection) {
		await ctx.reply(ctx.t("errors.reconnect", { provider }))
		return
	}
	const adapter = sourceRegistry.require(provider)
	const actionName = provider === "github" ? "comment" : "addComment"
	const action = adapter.actions[actionName]
	if (!action) {
		await ctx.reply(ctx.t("errors.notSupported"))
		return
	}
	const payload = provider === "github" ? githubActionPayload(event) : jiraActionPayload(event)
	try {
		await action({ type: "oauth", ...connection.credentials }, { ...payload, body })
		await ctx.reply(ctx.t("actionResult.commentPosted"))
	} catch (err) {
		logger.error({ err, eventId }, "comment submit failed")
		await ctx.reply(ctx.t("errors.actionFailed", { reason: String((err as Error).message) }))
	}
}

const SNOOZE_DELAYS_MS: Record<"snz1h" | "snz4h" | "snz1d", number> = {
	snz1h: 60 * 60 * 1000,
	snz4h: 4 * 60 * 60 * 1000,
	snz1d: 24 * 60 * 60 * 1000,
}

export const handleSnooze = async (
	ctx: Callback,
	eventId: string,
	kind: "snz1h" | "snz4h" | "snz1d",
): Promise<void> => {
	const event = await loadEventForUser(ctx, eventId)
	if (!event) {
		await replyError(ctx, "errors.notFound")
		return
	}
	const delay = SNOOZE_DELAYS_MS[kind]
	const wakeAt = new Date(Date.now() + delay)
	await db
		.update(events)
		.set({ status: "snoozed", snoozedUntil: wakeAt })
		.where(eq(events.id, eventId))
	const user = await getUserByTelegramId(db, ctx.from?.id ?? 0)
	if (!user) return
	await enqueueSnoozeWake(
		snoozeQueue,
		{ eventId, userId: user.id, telegramChatId: user.telegramChatId, locale: user.lang },
		delay,
	)
	const until = formatSnoozeUntil(wakeAt, user.lang, user.timezone)
	await replyAck(ctx, "actionResult.snoozed", { until })
	// Keep snoozeJobId import alive for type-only export plus future de-dup.
	void snoozeJobId
}

export const handleMute = async (ctx: Callback, eventId: string): Promise<void> => {
	const event = await loadEventForUser(ctx, eventId)
	if (!event) {
		await replyError(ctx, "errors.notFound")
		return
	}
	await ctx.answerCallbackQuery()
	const eventTypePrefix = event.type.split(".")[0] ?? event.type
	const kb = new InlineKeyboard()
	kb.text(
		ctx.t("mutes.scope.event_type", { value: eventTypePrefix }),
		`mute:create:event_type:${eventTypePrefix}:${event.id}`,
	).row()
	if (event.scope) {
		const scopeLabel = event.source === "jira" ? "project" : "repo"
		kb.text(
			ctx.t(`mutes.scope.${scopeLabel}`, { value: event.scope }),
			`mute:create:${scopeLabel}:${event.scope}:${event.id}`,
		).row()
	}
	kb.text(
		ctx.t("mutes.scope.source", { value: event.source }),
		`mute:create:source:${event.source}:${event.id}`,
	).row()
	await ctx.reply(ctx.t("mutes.choosePrompt"), { reply_markup: kb })
	// Keep addMute import alive (used by the create handler in bot/index.ts).
	void addMute
}

export const handleViewDiff = async (ctx: Callback, eventId: string): Promise<void> => {
	const event = await loadEventForUser(ctx, eventId)
	if (!event || event.source !== "github") {
		await replyError(ctx, "errors.notFound")
		return
	}
	const connection = await getConnection(db, event.userId, "github")
	if (!connection) {
		await replyError(ctx, "errors.reconnect", { provider: "github" })
		return
	}
	const metadata = (event.metadata as Record<string, unknown>) ?? {}
	const number = Number(metadata.prNumber)
	if (!event.scope || !Number.isFinite(number)) {
		await replyError(ctx, "errors.notSupported")
		return
	}
	const [owner, repo] = event.scope.split("/")
	if (!owner || !repo) {
		await replyError(ctx, "errors.notSupported")
		return
	}
	const { createGithubClient, getPullRequestDiff } = await import("@devpinger/sources-github")
	const client = createGithubClient({ accessToken: connection.credentials.accessToken })
	try {
		const diff = await getPullRequestDiff(client, { owner, repo, number })
		await ctx.answerCallbackQuery()
		if (!diff.trim()) {
			await ctx.reply(ctx.t("actionResult.diffEmpty"))
			return
		}
		if (diff.length > 4000) {
			await ctx.replyWithDocument(
				new (await import("grammy")).InputFile(Buffer.from(diff, "utf8"), `pr-${number}.diff`),
				{ caption: ctx.t("actionResult.diffTooBigFile") },
			)
			return
		}
		await ctx.reply(`<pre>${diff.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`, {
			parse_mode: "HTML",
		})
	} catch (err) {
		logger.error({ err, eventId }, "view diff failed")
		await replyError(ctx, "errors.actionFailed", { reason: String((err as Error).message) })
	}
}

export const handleTransition = async (ctx: Callback, eventId: string): Promise<void> => {
	const event = await loadEventForUser(ctx, eventId)
	if (!event || event.source !== "jira") {
		await replyError(ctx, "errors.notFound")
		return
	}
	await ctx.answerCallbackQuery()
	await ctx.reply(ctx.t("errors.notSupported"))
	void clearPendingAction
}

export const handleReply = handleComment
