import { env } from "../config.js"
import { signTg } from "../services/signed-tg.js"

// Build a signed OAuth-start URL for a given telegram user + provider.
// The signature gates the OAuth start route so a Telegram chat id alone
// can't be replayed by a third party.
export const oauthStartUrl = (telegramId: number, provider: "github" | "jira"): string => {
	const sig = signTg(telegramId, `oauth-${provider}-start`, env.ENCRYPTION_KEY)
	return `${env.PUBLIC_BASE_URL}/oauth/${provider}/start?sig=${sig}`
}
