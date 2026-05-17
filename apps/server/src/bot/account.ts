import {
	connections as connectionsTable,
	events as eventsTable,
	mutes as mutesTable,
	subscriptions as subscriptionsTable,
	users as usersTable,
} from "@devpinger/db"
import { and, desc, eq } from "drizzle-orm"
import { InputFile } from "grammy"
import type { CallbackQueryContext, CommandContext } from "grammy"
import { InlineKeyboard } from "grammy"
import { db } from "../db.js"
import { logger } from "../logger.js"
import { getUserByTelegramId } from "../services/users.js"
import type { BotContext } from "./index.js"

const EXPORT_LIMIT_EVENTS = 1000

export const handleUnsubscribeCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	const kb = new InlineKeyboard()
		.text(ctx.t("hubV2.account.confirmDeleteYes"), "account:delete:confirm")
		.text(ctx.t("hubV2.account.confirmDeleteNo"), "account:delete:cancel")
	await ctx.reply(ctx.t("hubV2.account.confirmDeleteText"), {
		parse_mode: "HTML",
		reply_markup: kb,
	})
}

export const handleDeleteConfirm = async (ctx: CallbackQueryContext<BotContext>): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) {
		await ctx.answerCallbackQuery({ text: "no user" })
		return
	}
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) {
		await ctx.answerCallbackQuery({ text: ctx.t("hubV2.account.alreadyDeletedToast") })
		try {
			await ctx.editMessageText(ctx.t("hubV2.account.alreadyDeletedText"))
		} catch {
			// best effort
		}
		return
	}
	try {
		await db.delete(usersTable).where(eq(usersTable.id, user.id))
	} catch (err) {
		logger.error({ err, userId: user.id }, "account delete failed")
		await ctx.answerCallbackQuery({ text: ctx.t("hubV2.account.deleteFailedToast") })
		return
	}
	await ctx.answerCallbackQuery({ text: ctx.t("hubV2.account.deletedToast") })
	try {
		await ctx.editMessageText(ctx.t("hubV2.account.deletedText"))
	} catch {
		// best effort
	}
	logger.info({ telegramId, userId: user.id }, "user account deleted")
}

export const handleDeleteCancel = async (ctx: CallbackQueryContext<BotContext>): Promise<void> => {
	await ctx.answerCallbackQuery({ text: ctx.t("hubV2.account.cancelledToast") })
	try {
		await ctx.deleteMessage()
	} catch {
		// best effort
	}
}

interface ExportShape {
	exportedAt: string
	user: {
		id: string
		telegramUsername: string | null
		lang: string
		timezone: string
		notifySelfActions: boolean
		plan: string
		createdAt: string
		lastSeenAt: string
	}
	connections: {
		provider: string
		providerUserId: string
		providerUsername: string | null
		createdAt: string
		updatedAt: string
	}[]
	subscriptions: {
		id: string
		provider: string
		providerScopeId: string
		displayName: string
		isActive: boolean
		createdAt: string
	}[]
	mutes: {
		id: string
		scopeType: string
		scopeValue: string
		createdAt: string
	}[]
	events: {
		id: string
		source: string
		type: string
		priority: string
		status: string
		title: string
		bodyPreview: string | null
		url: string
		scope: string | null
		actorUsername: string | null
		createdAt: string
		deliveredAt: string | null
	}[]
}

export const handleExportCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) {
		await ctx.reply(ctx.t("hubV2.account.exportEmpty"))
		return
	}

	const [connections, subscriptions, mutes, events] = await Promise.all([
		db.select().from(connectionsTable).where(eq(connectionsTable.userId, user.id)),
		db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id)),
		db.select().from(mutesTable).where(eq(mutesTable.userId, user.id)),
		db
			.select()
			.from(eventsTable)
			.where(eq(eventsTable.userId, user.id))
			.orderBy(desc(eventsTable.createdAt))
			.limit(EXPORT_LIMIT_EVENTS),
	])

	const payload: ExportShape = {
		exportedAt: new Date().toISOString(),
		user: {
			id: user.id,
			telegramUsername: user.telegramUsername,
			lang: user.lang,
			timezone: user.timezone,
			notifySelfActions: user.notifySelfActions,
			plan: user.plan,
			createdAt: user.createdAt.toISOString(),
			lastSeenAt: user.lastSeenAt.toISOString(),
		},
		connections: connections.map((c) => ({
			provider: c.provider,
			providerUserId: c.providerUserId,
			providerUsername: c.providerUsername,
			createdAt: c.createdAt.toISOString(),
			updatedAt: c.updatedAt.toISOString(),
		})),
		subscriptions: subscriptions.map((s) => ({
			id: s.id,
			provider: s.provider,
			providerScopeId: s.providerScopeId,
			displayName: s.displayName,
			isActive: s.isActive,
			createdAt: s.createdAt.toISOString(),
		})),
		mutes: mutes.map((m) => ({
			id: m.id,
			scopeType: m.scopeType,
			scopeValue: m.scopeValue,
			createdAt: m.createdAt.toISOString(),
		})),
		events: events.map((e) => ({
			id: e.id,
			source: e.source,
			type: e.type,
			priority: e.priority,
			status: e.status,
			title: e.title,
			bodyPreview: e.bodyPreview,
			url: e.url,
			scope: e.scope,
			actorUsername: e.actorUsername,
			createdAt: e.createdAt.toISOString(),
			deliveredAt: e.deliveredAt?.toISOString() ?? null,
		})),
	}

	const buffer = Buffer.from(JSON.stringify(payload, null, 2), "utf8")
	const fname = `devpinger-export-${user.id.slice(0, 8)}-${Date.now()}.json`
	await ctx.replyWithDocument(new InputFile(buffer, fname), {
		caption: ctx.t("hubV2.account.exportCaption", {
			events: events.length,
			limit: EXPORT_LIMIT_EVENTS,
		}),
	})
}

export const handleForgetEventCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return

	const arg = ctx.match?.toString().trim() ?? ""
	if (!arg) {
		await ctx.reply(ctx.t("hubV2.account.forgetEventUsage"))
		return
	}

	const result = await db
		.delete(eventsTable)
		.where(and(eq(eventsTable.id, arg), eq(eventsTable.userId, user.id)))
		.returning({ id: eventsTable.id })

	if (result.length === 0) {
		await ctx.reply(ctx.t("hubV2.account.forgetEventNotFound"))
		return
	}
	await ctx.reply(ctx.t("hubV2.account.forgetEventDone", { id: arg }))
}
