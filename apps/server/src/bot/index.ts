import { events as eventsTable, users } from "@devpinger/db"
import { formatEvent } from "@devpinger/destinations-telegram"
import { SUPPORTED_LOCALES, isLocale } from "@devpinger/i18n"
import { and, eq, sql } from "drizzle-orm"
import { Bot, type Context, InlineKeyboard } from "grammy"
import { env } from "../config.js"
import { db } from "../db.js"
import { dbEventToNormalized } from "../lib/db-event-to-normalized.js"
import { logger } from "../logger.js"
import { redisConnection } from "../queues.js"
import { captureError } from "../sentry.js"
import { listConnectedProviders } from "../services/connections.js"
import { recentEvents, userStats } from "../services/history.js"
import { deleteMuteById, listMutes } from "../services/mutes.js"
import { clearPendingAction, getPendingAction } from "../services/pending-action.js"
import { signTg } from "../services/signed-tg.js"
import { getUserByTelegramId, setNotifySelfActions, upsertUser } from "../services/users.js"
import {
	handleDeleteCancel,
	handleDeleteConfirm,
	handleExportCommand,
	handleForgetEventCommand,
	handleUnsubscribeCommand,
} from "./account.js"
import {
	handleApprove,
	handleClose,
	handleComment,
	handleMerge,
	handleMute,
	handleReply,
	handleSnooze,
	handleTransition,
	handleViewDiff,
	submitPendingComment,
} from "./actions.js"
import { type I18nFlavor, createI18nMiddleware } from "./i18n.js"
import { dbLocaleResolver } from "./locale-resolver.js"
import { handleProjectAdd, handleProjectRemove, handleProjectsCommand } from "./projects.js"
import { handleRepoAdd, handleRepoRemove, handleReposCommand } from "./repos.js"
import { handleHelpCommand } from "./help.js"
import { renderConnectionsSection } from "./hub/connections.js"
import { registerHub } from "./hub/index.js"
import { handleStatusCommand } from "./status.js"

export type BotContext = Context & I18nFlavor

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN)

bot.use(createI18nMiddleware(dbLocaleResolver))

bot.use(async (ctx, next) => {
	if (ctx.from?.id && ctx.chat?.id) {
		try {
			await upsertUser(db, {
				telegramId: ctx.from.id,
				telegramChatId: ctx.chat.id,
				telegramUsername: ctx.from.username ?? null,
				languageCode: ctx.from.language_code ?? null,
			})
		} catch (err) {
			logger.error({ err, telegramId: ctx.from.id }, "upsertUser failed")
		}
	}
	await next()
})

const oauthUrlFor = (telegramId: number) => (provider: "github" | "jira") => {
	const sig = signTg(telegramId, `oauth-${provider}-start`, env.ENCRYPTION_KEY)
	return `${env.PUBLIC_BASE_URL}/oauth/${provider}/start?sig=${sig}`
}

registerHub(bot, {
	connections: async (ctx) => {
		const tgId = ctx.from?.id
		if (!tgId) return
		const user = await getUserByTelegramId(db, tgId)
		if (!user) return
		const rendered = await renderConnectionsSection({
			db,
			userId: user.id,
			t: ctx.t,
			oauthUrl: oauthUrlFor(tgId),
		})
		await ctx.reply(rendered.text, {
			parse_mode: "HTML",
			reply_markup: rendered.keyboard,
		})
	},
	events: async (ctx) => {
		await ctx.reply(ctx.t("hubV2.events.title"), { parse_mode: "HTML" })
	},
	settings: async (ctx) => {
		await ctx.reply(ctx.t("hubV2.settings.title"), { parse_mode: "HTML" })
	},
	help: async (ctx) => {
		await ctx.reply(ctx.t("helpV2.text"), { parse_mode: "HTML" })
	},
})

bot.callbackQuery(/^hub:conn:open:(repos|projects)$/, async (ctx) => {
	await ctx.answerCallbackQuery()
	const target = ctx.match?.[1]
	if (target === "repos") {
		await handleReposCommand(ctx as unknown as Parameters<typeof handleReposCommand>[0])
	} else if (target === "projects") {
		await handleProjectsCommand(ctx as unknown as Parameters<typeof handleProjectsCommand>[0])
	}
})

bot.callbackQuery(/^hub:conn:disconnect:(github|jira)$/, async (ctx) => {
	await ctx.answerCallbackQuery()
	const provider = ctx.match?.[1] as "github" | "jira"
	const tgId = ctx.from?.id
	if (!tgId) return
	const user = await getUserByTelegramId(db, tgId)
	if (!user) return
	const { deleteConnection } = await import("../services/connections.js")
	const { removed } = await deleteConnection(db, user.id, provider)
	if (!removed) return
	const msgKey =
		provider === "github"
			? "hubV2.connections.disconnectedGithub"
			: "hubV2.connections.disconnectedJira"
	await ctx.reply(ctx.t(msgKey))
})

bot.callbackQuery("hub:close", async (ctx) => {
	await ctx.answerCallbackQuery()
	try {
		await ctx.deleteMessage()
	} catch {
		// best-effort
	}
})

bot.callbackQuery("hub:noop", async (ctx) => {
	await ctx.answerCallbackQuery()
})

const buildStartMenu = async (ctx: BotContext): Promise<InlineKeyboard> => {
	const tgId = ctx.from?.id
	if (!tgId) return new InlineKeyboard().text(ctx.t("menu.help"), "help")
	const sig = (provider: "github" | "jira") =>
		signTg(tgId, `oauth-${provider}-start`, env.ENCRYPTION_KEY)
	const oauthUrl = (provider: "github" | "jira") =>
		`${env.PUBLIC_BASE_URL}/oauth/${provider}/start?sig=${sig(provider)}`

	const user = await getUserByTelegramId(db, tgId)
	const connected = user
		? await listConnectedProviders(db, user.id)
		: new Map<"github" | "jira", { providerUsername: string | null }>()

	const kb = new InlineKeyboard()
	const addRow = (provider: "github" | "jira", label: string, displayName: string) => {
		const entry = connected.get(provider)
		if (entry) {
			const handle = entry.providerUsername ? `: @${entry.providerUsername}` : ""
			kb.text(`✅ ${displayName}${handle}`, `oauth:info:${provider}`).row()
		} else {
			kb.url(label, oauthUrl(provider)).row()
		}
	}
	addRow("github", ctx.t("menu.connectGithub"), "GitHub")
	addRow("jira", ctx.t("menu.connectJira"), "Jira")
	return kb.text(ctx.t("menu.language"), "lang").text(ctx.t("menu.help"), "help")
}

bot.command("start", async (ctx) => {
	const payload = ctx.match?.toString().trim() ?? ""

	if (payload === "connected_github" || payload === "connected_jira") {
		const provider = payload === "connected_github" ? "github" : "jira"
		const user = ctx.from?.id ? await getUserByTelegramId(db, ctx.from.id) : null
		const connected = user
			? await listConnectedProviders(db, user.id)
			: new Map<"github" | "jira", { providerUsername: string | null }>()
		const entry = connected.get(provider)
		const login = entry?.providerUsername ?? ctx.from?.username ?? "you"
		if (provider === "github") {
			await ctx.reply(ctx.t("start.connectedGithub", { login }))
			await handleReposCommand(ctx)
		} else {
			await ctx.reply(ctx.t("start.connectedJira", { login }))
			await handleProjectsCommand(ctx)
		}
		return
	}

	if (payload.startsWith("event_")) {
		const eventId = payload.slice("event_".length)
		const tgId = ctx.from?.id
		if (!tgId) return
		const user = await getUserByTelegramId(db, tgId)
		if (!user) return
		const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1)
		if (!event || event.userId !== user.id) {
			await ctx.reply(ctx.t("eventDeepLink.notFound"))
			return
		}
		const normalized = dbEventToNormalized(event)
		const formatted = formatEvent({
			event: normalized,
			lang: user.lang,
			eventId: event.id,
		})
		await ctx.reply(formatted.text, {
			parse_mode: "HTML",
			link_preview_options: { is_disabled: true },
			reply_markup: formatted.keyboard,
		})
		return
	}

	const username = ctx.from?.username
	const text = username ? ctx.t("start.welcome", { username }) : ctx.t("start.welcomeFallback")
	await ctx.reply(text, { reply_markup: await buildStartMenu(ctx) })
})

bot.command("help", handleHelpCommand)

bot.command("sources", async (ctx) => {
	await ctx.reply(
		[ctx.t("sources.header"), ctx.t("sources.github"), ctx.t("sources.jira")].join("\n\n"),
		{ parse_mode: "HTML" },
	)
})

bot.command("repos", handleReposCommand)
bot.command("projects", handleProjectsCommand)

bot.callbackQuery(/^repo:add:(.+)$/, async (ctx) => {
	const fullName = ctx.match?.[1]
	if (fullName) await handleRepoAdd(ctx, fullName)
})

bot.callbackQuery(/^repo:rm:(.+)$/, async (ctx) => {
	const subId = ctx.match?.[1]
	if (subId) await handleRepoRemove(ctx, subId)
})

bot.callbackQuery(/^proj:add:(.+)$/, async (ctx) => {
	const key = ctx.match?.[1]
	if (key) await handleProjectAdd(ctx, key)
})

bot.callbackQuery(/^proj:rm:(.+)$/, async (ctx) => {
	const subId = ctx.match?.[1]
	if (subId) await handleProjectRemove(ctx, subId)
})

bot.command("mutes", async (ctx) => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const list = await listMutes(db, user.id)
	if (list.length === 0) {
		await ctx.reply(ctx.t("mutes.empty"))
		return
	}
	const header = ctx.t("mutes.listHeader")
	const kb = new InlineKeyboard()
	for (const m of list) {
		const label = ctx.t(`mutes.scope.${m.scopeType}`, { value: m.scopeValue })
		kb.text(`🗑 ${label}`, `mute:rm:${m.id}`).row()
	}
	await ctx.reply(header, { reply_markup: kb })
})

bot.command("recent", async (ctx) => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const list = await recentEvents(db, user.id, user.plan, 20)
	if (list.length === 0) {
		await ctx.reply(ctx.t("history.recentEmpty"))
		return
	}
	const header = ctx.t("history.recentHeader", { count: list.length })
	const lines = list.map((e) => `• [${e.source}] ${e.title}${e.scope ? ` — ${e.scope}` : ""}`)
	await ctx.reply(`${header}\n${lines.join("\n")}`)
})

bot.command("stats", async (ctx) => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const stats = await userStats(db, user.id, user.plan)
	if (stats.total === 0) {
		await ctx.reply(ctx.t("history.statsEmpty"))
		return
	}
	await ctx.reply(
		ctx.t("history.statsBody", {
			total: stats.total,
			delivered: stats.delivered,
			muted: stats.muted,
			high: stats.highPriority,
			medium: stats.mediumPriority,
			low: stats.lowPriority,
			github: stats.bySource.github,
			jira: stats.bySource.jira,
		}),
		{ parse_mode: "HTML" },
	)
})

bot.command("lang", async (ctx) => {
	const kb = new InlineKeyboard()
	for (const locale of SUPPORTED_LOCALES) {
		kb.text(locale === "en" ? "English" : "Русский", `lang:set:${locale}`).row()
	}
	await ctx.reply(ctx.t("settings.langPrompt"), { reply_markup: kb })
})

bot.command("notify_self", async (ctx) => {
	const telegramId = ctx.from?.id
	if (!telegramId || telegramId !== env.ADMIN_TELEGRAM_ID) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const arg = ctx.match?.toString().trim().toLowerCase()
	if (arg === "on" || arg === "off") {
		const next = arg === "on"
		await setNotifySelfActions(db, user.id, next)
		await ctx.reply(next ? ctx.t("settings.notifySelfOn") : ctx.t("settings.notifySelfOff"))
		return
	}
	const state = user.notifySelfActions
		? ctx.t("settings.notifySelfOn")
		: ctx.t("settings.notifySelfOff")
	await ctx.reply(ctx.t("settings.notifySelfStatus", { state }))
})

bot.command("status", handleStatusCommand)

bot.command("unsubscribe", handleUnsubscribeCommand)
bot.command("export", handleExportCommand)
bot.command("forget_event", handleForgetEventCommand)

bot.callbackQuery("account:delete:confirm", handleDeleteConfirm)
bot.callbackQuery("account:delete:cancel", handleDeleteCancel)

bot.command("cancel", async (ctx) => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	await clearPendingAction(redisConnection, telegramId)
	await ctx.reply(ctx.t("actionResult.commentCancelled"))
})

bot.callbackQuery(/^lang:set:(en|ru)$/, async (ctx) => {
	await ctx.answerCallbackQuery()
	const target = ctx.match?.[1]
	if (!isLocale(target)) return
	const telegramId = ctx.from?.id
	if (telegramId) {
		await db
			.update(users)
			.set({ lang: target, lastSeenAt: sql`now()` })
			.where(eq(users.telegramId, telegramId))
	}
	await ctx.reply(target === "ru" ? "Язык переключён на русский." : "Language switched to English.")
})

bot.callbackQuery(/^oauth:info:(github|jira)$/, async (ctx) => {
	await ctx.answerCallbackQuery()
	const provider = ctx.match?.[1]
	const name = provider === "github" ? "GitHub" : "Jira"
	await ctx.reply(ctx.t("menu.connectedHint", { provider: name }))
})

bot.callbackQuery(/^act:approve:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleApprove(ctx, eventId)
})

bot.callbackQuery(/^act:comment:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleComment(ctx, eventId)
})

bot.callbackQuery(/^act:reply:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleReply(ctx, eventId)
})

bot.callbackQuery(/^act:view:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleViewDiff(ctx, eventId)
})

bot.callbackQuery(/^act:close:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleClose(ctx, eventId)
})

bot.callbackQuery(/^act:merge:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleMerge(ctx, eventId)
})

bot.callbackQuery(/^act:trans:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleTransition(ctx, eventId)
})

bot.callbackQuery(/^act:(snz1h|snz4h|snz1d):(.+)$/, async (ctx) => {
	const kind = ctx.match?.[1] as "snz1h" | "snz4h" | "snz1d" | undefined
	const eventId = ctx.match?.[2]
	if (kind && eventId) await handleSnooze(ctx, eventId, kind)
})

bot.callbackQuery(/^act:mute:(.+)$/, async (ctx) => {
	const eventId = ctx.match?.[1]
	if (eventId) await handleMute(ctx, eventId)
})

bot.callbackQuery(/^mute:rm:([0-9a-f-]+)$/, async (ctx) => {
	const muteId = ctx.match?.[1]
	if (!muteId) return
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) {
		await ctx.answerCallbackQuery({ text: ctx.t("errors.notFound") })
		return
	}
	const { removed } = await deleteMuteById(db, user.id, muteId)
	await ctx.answerCallbackQuery({
		text: removed ? ctx.t("mutes.removed") : ctx.t("errors.notFound"),
	})
	if (!removed) return
	const remaining = await listMutes(db, user.id)
	if (remaining.length === 0) {
		try {
			await ctx.editMessageText(ctx.t("mutes.empty"))
		} catch {
			// message too old or already edited
		}
		return
	}
	const kb = new InlineKeyboard()
	for (const m of remaining) {
		const label = ctx.t(`mutes.scope.${m.scopeType}`, { value: m.scopeValue })
		kb.text(`🗑 ${label}`, `mute:rm:${m.id}`).row()
	}
	try {
		await ctx.editMessageReplyMarkup({ reply_markup: kb })
	} catch {
		// best effort
	}
})

bot.callbackQuery(/^mute:create:(source|repo|project|event_type):([^:]+):(.+)$/, async (ctx) => {
	const scopeType = ctx.match?.[1] as "source" | "repo" | "project" | "event_type" | undefined
	const scopeValue = ctx.match?.[2]
	if (!scopeType || !scopeValue) return
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const { addMute } = await import("../services/mutes.js")
	const { created } = await addMute(db, user.id, scopeType, scopeValue)
	const label = ctx.t(`mutes.scope.${scopeType}`, { value: scopeValue })
	await ctx.answerCallbackQuery({
		text: created ? ctx.t("actionResult.muted", { scope: label }) : ctx.t("mutes.alreadyExists"),
	})
	try {
		await ctx.deleteMessage()
	} catch {
		// best effort
	}
})

bot.callbackQuery("help", async (ctx) => {
	await ctx.answerCallbackQuery()
	await ctx.reply(ctx.t("helpV2.text"), { parse_mode: "HTML" })
})

bot.callbackQuery("lang", async (ctx) => {
	await ctx.answerCallbackQuery()
	const kb = new InlineKeyboard()
	for (const locale of SUPPORTED_LOCALES) {
		kb.text(locale === "en" ? "English" : "Русский", `lang:set:${locale}`).row()
	}
	await ctx.reply(ctx.t("settings.langPrompt"), { reply_markup: kb })
})

bot.on("message:text", async (ctx, next) => {
	const telegramId = ctx.from?.id
	const text = ctx.message?.text
	if (!telegramId || !text) {
		await next()
		return
	}
	// Any new command voids an in-flight pending action: if the user sends
	// /repos while a pending comment is open, treat that as "abandon the
	// comment and run /repos". Only /cancel announces the abandonment; other
	// commands silently clear and proceed.
	if (text.startsWith("/")) {
		const pending = await getPendingAction(redisConnection, telegramId)
		if (pending) await clearPendingAction(redisConnection, telegramId)
		await next()
		return
	}
	const pending = await getPendingAction(redisConnection, telegramId)
	if (!pending) {
		await next()
		return
	}
	if (pending.expiresAt < Date.now()) {
		await clearPendingAction(redisConnection, telegramId)
		await ctx.reply(ctx.t("actionResult.commentExpired"))
		return
	}
	await clearPendingAction(redisConnection, telegramId)
	if (pending.kind === "comment") {
		await submitPendingComment(ctx, pending.eventId, text)
	}
})

bot.catch(async (err) => {
	logger.error({ err: err.error }, "bot error")
	captureError(err.error, { update: err.ctx.update?.update_id })
})

// suppress unused-vars warning for and-import; kept for future query helpers.
void and
