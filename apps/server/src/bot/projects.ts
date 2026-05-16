import { createJiraClient } from "@devpinger/sources-jira"
import type { CallbackQueryContext, CommandContext, Context } from "grammy"
import { InlineKeyboard } from "grammy"
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types"
import { env } from "../config.js"
import { db } from "../db.js"
import { logger } from "../logger.js"
import { sourceRegistry } from "../registries.js"

const replaceButton = (
	existing: InlineKeyboardMarkup | undefined,
	targetData: string,
	newLabel: string,
	newData: string,
): InlineKeyboardMarkup | null => {
	if (!existing) return null
	let touched = false
	const rows: InlineKeyboardButton[][] = existing.inline_keyboard.map((row) =>
		row.map((btn) => {
			if ("callback_data" in btn && btn.callback_data === targetData) {
				touched = true
				return { text: newLabel, callback_data: newData }
			}
			return btn
		}),
	)
	return touched ? { inline_keyboard: rows } : null
}
import { getConnection } from "../services/connections.js"
import {
	createSubscription,
	deactivateSubscription,
	findSubscriptionById,
	listSubscriptions,
} from "../services/subscriptions.js"
import { getUserByTelegramId } from "../services/users.js"
import type { I18nFlavor } from "./i18n.js"

type BotContext = Context & I18nFlavor

const MAX_BUTTONS = 20

interface JiraProject {
	id: string
	key: string
	name: string
}

interface JiraProjectSearchResponse {
	values?: JiraProject[]
}

const fetchProjects = async (
	accessToken: string,
	cloudId: string,
	query: string,
): Promise<JiraProject[]> => {
	const client = createJiraClient({ accessToken, cloudId })
	const params = new URLSearchParams({
		maxResults: String(MAX_BUTTONS),
		orderBy: "lastIssueUpdatedTime",
	})
	if (query) params.set("query", query)
	const res = await client.get<JiraProjectSearchResponse>(
		`/rest/api/3/project/search?${params.toString()}`,
	)
	return res.values ?? []
}

export const handleProjectsCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const connection = await getConnection(db, user.id, "jira")
	if (!connection) {
		await ctx.reply(ctx.t("errors.unauthorized"))
		return
	}
	const cloudId = connection.credentials.jiraCloudId
	if (!cloudId) {
		await ctx.reply(ctx.t("jiraProjects.loadError"))
		return
	}

	const query = ctx.match?.toString().trim() ?? ""
	let projects: JiraProject[]
	try {
		projects = await fetchProjects(connection.credentials.accessToken, cloudId, query)
	} catch (err) {
		logger.error({ err, query }, "jira project search failed")
		await ctx.reply(ctx.t("jiraProjects.loadError"))
		return
	}

	if (projects.length === 0) {
		await ctx.reply(
			query.length > 0 ? ctx.t("jiraProjects.searchEmpty", { query }) : ctx.t("jiraProjects.empty"),
		)
		return
	}

	const subs = await listSubscriptions(db, user.id, "jira")
	const subByScope = new Map(subs.map((s) => [s.providerScopeId, s] as const))

	const kb = new InlineKeyboard()
	for (const project of projects.slice(0, MAX_BUTTONS)) {
		const label = `${project.key} — ${project.name}`
		const existing = subByScope.get(project.key)
		if (existing) {
			kb.text(`➖ ${label}`, `proj:rm:${existing.id}`).row()
		} else {
			kb.text(`➕ ${label}`, `proj:add:${project.key}`).row()
		}
	}
	const header =
		query.length > 0
			? ctx.t("jiraProjects.searchHeader", { query, count: projects.length })
			: ctx.t("jiraProjects.prompt")
	await ctx.reply(header, { reply_markup: kb })
}

export const handleProjectAdd = async (
	ctx: CallbackQueryContext<BotContext>,
	projectKey: string,
): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const connection = await getConnection(db, user.id, "jira")
	if (!connection) {
		await ctx.answerCallbackQuery({ text: ctx.t("errors.unauthorized") })
		return
	}
	try {
		const adapter = sourceRegistry.require("jira")
		const result = await adapter.subscriptions.create(
			{ type: "oauth", ...connection.credentials },
			{
				providerScopeId: projectKey,
				callbackUrl: `${env.PUBLIC_BASE_URL}/webhooks/jira`,
			},
		)
		const sub = await createSubscription(db, {
			userId: user.id,
			provider: "jira",
			providerScopeId: projectKey,
			displayName: projectKey,
			webhookSecret: result.webhookSecret ?? null,
		})
		await ctx.answerCallbackQuery({ text: ctx.t("jiraProjects.added", { key: projectKey }) })
		const oldBtn = ctx.callbackQuery.message?.reply_markup?.inline_keyboard
			.flat()
			.find((b) => "callback_data" in b && b.callback_data === `proj:add:${projectKey}`)
		const oldLabel = oldBtn?.text ?? `➖ ${projectKey}`
		const newMarkup = replaceButton(
			ctx.callbackQuery.message?.reply_markup,
			`proj:add:${projectKey}`,
			oldLabel.replace(/^➕/, "➖"),
			`proj:rm:${sub.id}`,
		)
		if (newMarkup) {
			try {
				await ctx.editMessageReplyMarkup({ reply_markup: newMarkup })
			} catch {
				// best effort
			}
		}
	} catch (err) {
		logger.error({ err, projectKey }, "jira project add failed")
		await ctx.answerCallbackQuery({ text: ctx.t("jiraProjects.loadError") })
	}
}

export const handleProjectRemove = async (
	ctx: CallbackQueryContext<BotContext>,
	subscriptionId: string,
): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const sub = await findSubscriptionById(db, subscriptionId)
	if (!sub || sub.userId !== user.id || sub.provider !== "jira") {
		await ctx.answerCallbackQuery({ text: ctx.t("errors.notFound") })
		return
	}
	await deactivateSubscription(db, sub.id)
	await ctx.answerCallbackQuery({
		text: ctx.t("jiraProjects.removed", { key: sub.providerScopeId }),
	})
	const oldBtn = ctx.callbackQuery.message?.reply_markup?.inline_keyboard
		.flat()
		.find((b) => "callback_data" in b && b.callback_data === `proj:rm:${sub.id}`)
	const oldLabel = oldBtn?.text ?? `➕ ${sub.providerScopeId}`
	const newMarkup = replaceButton(
		ctx.callbackQuery.message?.reply_markup,
		`proj:rm:${sub.id}`,
		oldLabel.replace(/^➖/, "➕"),
		`proj:add:${sub.providerScopeId}`,
	)
	if (newMarkup) {
		try {
			await ctx.editMessageReplyMarkup({ reply_markup: newMarkup })
		} catch {
			// best effort
		}
	}
}
