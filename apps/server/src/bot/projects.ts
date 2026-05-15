import { createJiraClient } from "@devpinger/sources-jira"
import type { CallbackQueryContext, CommandContext, Context } from "grammy"
import { InlineKeyboard } from "grammy"
import { db } from "../db.js"
import { logger } from "../logger.js"
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
			query.length > 0
				? ctx.t("jiraProjects.searchEmpty", { query })
				: ctx.t("jiraProjects.empty"),
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
	try {
		await createSubscription(db, {
			userId: user.id,
			provider: "jira",
			providerScopeId: projectKey,
			displayName: projectKey,
		})
		await ctx.answerCallbackQuery()
		await ctx.reply(ctx.t("jiraProjects.added", { key: projectKey }))
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
	await ctx.answerCallbackQuery()
	await ctx.reply(ctx.t("jiraProjects.removed", { key: sub.providerScopeId }))
}
