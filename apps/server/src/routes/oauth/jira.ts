import { type Locale, botMessages, createTranslator } from "@devpinger/i18n"
import {
	type JiraCredentials,
	type JiraResource,
	type JiraTokenResponse,
	buildAuthorizeUrl,
	createJiraClient,
	exchangeCodeForToken,
	fetchAccessibleResources,
} from "@devpinger/sources-jira"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { mainReplyKeyboard } from "../../bot/hub/keyboard.js"
import { bot } from "../../bot/index.js"
import { renderOnboardingStep2 } from "../../bot/onboarding.js"
import { env } from "../../config.js"
import { db } from "../../db.js"
import { logger } from "../../logger.js"
import { upsertConnection } from "../../services/connections.js"
import { consumeOauthState, createOauthState } from "../../services/oauth-state.js"
import { verifyTg } from "../../services/signed-tg.js"
import { getUserById, getUserByTelegramId } from "../../services/users.js"

const startQuerySchema = z.object({ sig: z.string().min(1) })
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) })

const redirectUri = (): string => `${env.PUBLIC_BASE_URL}/oauth/jira/callback`

export const jiraOauthRoutes = async (app: FastifyInstance) => {
	app.get("/oauth/jira/start", async (req, reply) => {
		const parsed = startQuerySchema.safeParse(req.query)
		if (!parsed.success) return reply.code(400).send({ error: "missing sig" })
		const tg = verifyTg(parsed.data.sig, "oauth-jira-start", env.ENCRYPTION_KEY)
		if (!tg) return reply.code(401).send({ error: "invalid or expired link" })
		const user = await getUserByTelegramId(db, tg)
		if (!user) return reply.code(404).send({ error: "user not found — /start the bot first" })
		const state = await createOauthState(db, { userId: user.id, provider: "jira" })
		const url = buildAuthorizeUrl({
			clientId: env.JIRA_OAUTH_CLIENT_ID,
			redirectUri: redirectUri(),
			state,
		})
		return reply.redirect(url)
	})

	app.get("/oauth/jira/callback", async (req, reply) => {
		const parsed = callbackQuerySchema.safeParse(req.query)
		if (!parsed.success) return reply.code(400).send({ error: "invalid callback params" })
		const state = await consumeOauthState(db, parsed.data.state)
		if (!state || state.provider !== "jira") {
			return reply.code(400).send({ error: "invalid or expired state" })
		}

		let token: JiraTokenResponse
		try {
			token = await exchangeCodeForToken({
				clientId: env.JIRA_OAUTH_CLIENT_ID,
				clientSecret: env.JIRA_OAUTH_CLIENT_SECRET,
				code: parsed.data.code,
				redirectUri: redirectUri(),
			})
		} catch (err) {
			logger.error({ err }, "jira token exchange failed")
			return reply.code(502).send({ error: "jira token exchange failed" })
		}

		let resources: JiraResource[] = []
		try {
			resources = await fetchAccessibleResources(token.access_token)
		} catch (err) {
			logger.warn({ err }, "jira accessible-resources call failed; saving without site")
		}
		const primary = resources[0]

		// Look up the viewer's accountId for self-suppression / mention detection.
		let viewerAccountId = `unknown-${state.userId}`
		let viewerDisplayName: string | null = primary?.name ?? null
		if (primary) {
			try {
				const client = createJiraClient({
					accessToken: token.access_token,
					cloudId: primary.id,
				})
				const me = await client.get<{
					accountId: string
					displayName: string
					emailAddress?: string
				}>("/rest/api/3/myself")
				viewerAccountId = me.accountId
				viewerDisplayName = me.displayName
			} catch (err) {
				logger.warn({ err }, "jira myself lookup failed; falling back to cloud-name")
			}
		}

		const credentials: JiraCredentials = {
			type: "oauth",
			accessToken: token.access_token,
			refreshToken: token.refresh_token,
			expiresAt: token.expires_in
				? new Date(Date.now() + token.expires_in * 1000).toISOString()
				: undefined,
			scopes: token.scope ? token.scope.split(" ") : undefined,
			jiraCloudId: primary?.id,
		}

		await upsertConnection(db, {
			userId: state.userId,
			provider: "jira",
			providerUserId: viewerAccountId,
			providerUsername: viewerDisplayName,
			credentials,
		})

		logger.info({ userId: state.userId, cloudId: primary?.id ?? null }, "jira oauth connected")

		try {
			const user = await getUserById(db, state.userId)
			if (user) {
				const t = createTranslator(botMessages[user.lang as Locale])
				if (user.onboardingCompletedAt === null) {
					const step2 = renderOnboardingStep2({ t, provider: "jira" })
					await bot.api.sendMessage(user.telegramChatId, step2.text, {
						parse_mode: "HTML",
						reply_markup: step2.keyboard,
					})
				} else {
					await bot.api.sendMessage(
						user.telegramChatId,
						t("hubV2.connections.jiraConnected", {
							login: viewerDisplayName ?? "you",
						}),
						{
							reply_markup: {
								keyboard: mainReplyKeyboard(t).build(),
								resize_keyboard: true,
								is_persistent: true,
							},
						},
					)
				}
			}
		} catch (err) {
			logger.warn(
				{ err, userId: state.userId },
				"failed to push step2 to telegram after jira oauth",
			)
		}

		return reply.redirect(`https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=connected_jira`)
	})
}
