import {
	type GithubClient,
	type GithubRepoSummary,
	createGithubClient,
	listAccessibleRepos,
	removeRepoWebhook,
} from "@devpinger/sources-github"
import type { CallbackQueryContext, CommandContext, Context } from "grammy"
import { InlineKeyboard } from "grammy"
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types"
import { env } from "../config.js"
import { db } from "../db.js"
import { logger } from "../logger.js"
import { sourceRegistry } from "../registries.js"
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

// GitHub Search API's `user:<login>` qualifier excludes org/collaborator
// repos — useless when the user belongs to an org whose repos they
// actually want to watch. Instead, paginate `listForAuthenticatedUser`
// (which honours collaborator + organization_member affiliations) and
// filter client-side. Capped so a user with thousands of repos doesn't
// hammer GitHub on every search.
const PAGE_SIZE = 100
const MAX_PAGES = 5

const fetchAccessibleRepos = async (client: GithubClient): Promise<GithubRepoSummary[]> => {
	const iterator = client.paginate.iterator(client.rest.repos.listForAuthenticatedUser, {
		per_page: PAGE_SIZE,
		affiliation: "owner,collaborator,organization_member",
		sort: "updated",
	})
	const out: GithubRepoSummary[] = []
	let pages = 0
	for await (const { data } of iterator) {
		for (const r of data) {
			out.push({
				id: r.id,
				name: r.name,
				fullName: r.full_name,
				private: r.private,
				htmlUrl: r.html_url,
				defaultBranch: r.default_branch ?? "main",
				updatedAt: r.updated_at,
			})
		}
		pages += 1
		if (pages >= MAX_PAGES) break
	}
	return out
}

const filterByQuery = (repos: GithubRepoSummary[], query: string): GithubRepoSummary[] => {
	const needle = query.trim().toLowerCase()
	if (needle.length === 0) return repos
	return repos.filter((r) => r.fullName.toLowerCase().includes(needle))
}

// Build a new InlineKeyboardMarkup that mirrors the existing one but with
// the button whose callback_data matches `targetData` replaced by
// (newLabel, newData). Telegram doesn't let us mutate one button in place;
// we have to re-send the whole markup.
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

export const handleReposCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const connection = await getConnection(db, user.id, "github")
	if (!connection) {
		await ctx.reply(ctx.t("errors.unauthorized"))
		return
	}

	const query = ctx.match?.toString().trim() ?? ""
	const client = createGithubClient({ accessToken: connection.credentials.accessToken })

	let repos: GithubRepoSummary[]
	try {
		if (query.length > 0) {
			const all = await fetchAccessibleRepos(client)
			repos = filterByQuery(all, query).slice(0, MAX_BUTTONS)
		} else {
			repos = await listAccessibleRepos(client, { perPage: MAX_BUTTONS })
		}
	} catch (err) {
		logger.error({ err, query }, "github repo lookup failed")
		await ctx.reply(ctx.t("repos.loadError"))
		return
	}

	if (repos.length === 0) {
		await ctx.reply(query.length > 0 ? ctx.t("repos.searchEmpty", { query }) : ctx.t("repos.empty"))
		return
	}

	const subs = await listSubscriptions(db, user.id, "github")
	const subByScope = new Map(subs.map((s) => [s.providerScopeId, s] as const))

	const kb = new InlineKeyboard()
	for (const repo of repos.slice(0, MAX_BUTTONS)) {
		const existing = subByScope.get(repo.fullName)
		if (existing) {
			kb.text(`➖ ${repo.fullName}`, `repo:rm:${existing.id}`).row()
		} else {
			kb.text(`➕ ${repo.fullName}`, `repo:add:${repo.fullName}`).row()
		}
	}
	const header =
		query.length > 0
			? ctx.t("repos.searchHeader", { query, count: repos.length })
			: ctx.t("repos.prompt")
	await ctx.reply(header, { reply_markup: kb })
}

export const handleRepoAdd = async (
	ctx: CallbackQueryContext<BotContext>,
	fullName: string,
): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const connection = await getConnection(db, user.id, "github")
	if (!connection) {
		await ctx.answerCallbackQuery({ text: ctx.t("errors.unauthorized") })
		return
	}
	const adapter = sourceRegistry.require("github")
	try {
		const result = await adapter.subscriptions.create(
			{ type: "oauth", ...connection.credentials },
			{
				providerScopeId: fullName,
				callbackUrl: `${env.PUBLIC_BASE_URL}/webhooks/github`,
			},
		)
		const sub = await createSubscription(db, {
			userId: user.id,
			provider: "github",
			providerScopeId: fullName,
			displayName: fullName,
			webhookId: result.subscriptionId,
			webhookSecret: result.webhookSecret ?? null,
		})
		await ctx.answerCallbackQuery({ text: ctx.t("repos.added", { fullName }) })
		const newMarkup = replaceButton(
			ctx.callbackQuery.message?.reply_markup,
			`repo:add:${fullName}`,
			`➖ ${fullName}`,
			`repo:rm:${sub.id}`,
		)
		if (newMarkup) {
			try {
				await ctx.editMessageReplyMarkup({ reply_markup: newMarkup })
			} catch {
				// message too old; toast is sufficient
			}
		}
	} catch (err) {
		logger.error({ err, fullName }, "repo add failed")
		await ctx.answerCallbackQuery({
			text: ctx.t("repos.setupFailed", { fullName }),
		})
	}
}

export const handleRepoRemove = async (
	ctx: CallbackQueryContext<BotContext>,
	subscriptionId: string,
): Promise<void> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const sub = await findSubscriptionById(db, subscriptionId)
	if (!sub || sub.userId !== user.id || sub.provider !== "github") {
		await ctx.answerCallbackQuery({ text: ctx.t("errors.notFound") })
		return
	}
	const connection = await getConnection(db, user.id, "github")
	if (!connection) {
		await ctx.answerCallbackQuery({ text: ctx.t("errors.unauthorized") })
		return
	}
	const [owner, repo] = sub.providerScopeId.split("/")
	const hookId = Number(sub.webhookId)
	if (owner && repo && Number.isFinite(hookId)) {
		try {
			const client = createGithubClient({ accessToken: connection.credentials.accessToken })
			await removeRepoWebhook(client, { owner, repo, hookId })
		} catch (err) {
			logger.warn(
				{ err, subId: sub.id, scopeId: sub.providerScopeId },
				"github removeRepoWebhook failed; deactivating subscription anyway",
			)
		}
	}
	await deactivateSubscription(db, sub.id)
	await ctx.answerCallbackQuery({
		text: ctx.t("repos.removed", { fullName: sub.providerScopeId }),
	})
	const newMarkup = replaceButton(
		ctx.callbackQuery.message?.reply_markup,
		`repo:rm:${sub.id}`,
		`➕ ${sub.providerScopeId}`,
		`repo:add:${sub.providerScopeId}`,
	)
	if (newMarkup) {
		try {
			await ctx.editMessageReplyMarkup({ reply_markup: newMarkup })
		} catch {
			// best effort
		}
	}
}
