import { type Locale, botMessages, createTranslator } from "@devpinger/i18n"
import {
	type GithubCredentials,
	type GithubTokenResponse,
	buildAuthorizeUrl,
	createGithubClient,
	exchangeCodeForToken,
	getViewer,
} from "@devpinger/sources-github"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
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

const redirectUri = (): string => `${env.PUBLIC_BASE_URL}/oauth/github/callback`

export const githubOauthRoutes = async (app: FastifyInstance) => {
	app.get("/oauth/github/start", async (req, reply) => {
		const parsed = startQuerySchema.safeParse(req.query)
		if (!parsed.success) {
			return reply.code(400).send({ error: "missing sig param" })
		}
		const tg = verifyTg(parsed.data.sig, "oauth-github-start", env.ENCRYPTION_KEY)
		if (!tg) return reply.code(401).send({ error: "invalid or expired link" })
		const user = await getUserByTelegramId(db, tg)
		if (!user) return reply.code(404).send({ error: "user not found — /start the bot first" })
		const state = await createOauthState(db, { userId: user.id, provider: "github" })
		const url = buildAuthorizeUrl({
			clientId: env.GITHUB_OAUTH_CLIENT_ID,
			redirectUri: redirectUri(),
			state,
		})
		return reply.redirect(url)
	})

	app.get("/oauth/github/callback", async (req, reply) => {
		const parsed = callbackQuerySchema.safeParse(req.query)
		if (!parsed.success) {
			return reply.code(400).send({ error: "invalid callback params" })
		}
		const state = await consumeOauthState(db, parsed.data.state)
		if (!state || state.provider !== "github") {
			return reply.code(400).send({ error: "invalid or expired state" })
		}

		let token: GithubTokenResponse
		try {
			token = await exchangeCodeForToken({
				clientId: env.GITHUB_OAUTH_CLIENT_ID,
				clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
				code: parsed.data.code,
				redirectUri: redirectUri(),
			})
		} catch (err) {
			logger.error({ err }, "github token exchange failed")
			return reply.code(502).send({ error: "github token exchange failed" })
		}

		const client = createGithubClient({ accessToken: token.accessToken })
		const viewer = await getViewer(client)

		const credentials: GithubCredentials = {
			type: "oauth",
			accessToken: token.accessToken,
			scopes: token.scopes,
		}

		await upsertConnection(db, {
			userId: state.userId,
			provider: "github",
			providerUserId: String(viewer.id),
			providerUsername: viewer.login,
			credentials,
		})

		logger.info({ userId: state.userId, githubLogin: viewer.login }, "github oauth connected")

		try {
			const user = await getUserById(db, state.userId)
			if (user) {
				const t = createTranslator(botMessages[user.lang as Locale])
				const step2 = renderOnboardingStep2({ t, provider: "github" })
				await bot.api.sendMessage(user.telegramChatId, step2.text, {
					parse_mode: "HTML",
					reply_markup: step2.keyboard,
				})
			}
		} catch (err) {
			logger.warn({ err, userId: state.userId }, "failed to push step2 to telegram after github oauth")
		}

		return reply.redirect(`https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=connected_github`)
	})
}
