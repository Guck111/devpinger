import type { Locale } from "./locales.js"
import enBot from "./messages/en/bot.json" with { type: "json" }
import enCommon from "./messages/en/common.json" with { type: "json" }
import ruBot from "./messages/ru/bot.json" with { type: "json" }
import ruCommon from "./messages/ru/common.json" with { type: "json" }

export type BotMessages = typeof enBot
export type CommonMessages = typeof enCommon

export const botMessages: Record<Locale, BotMessages> = {
	en: enBot,
	ru: ruBot as BotMessages,
}

export const commonMessages: Record<Locale, CommonMessages> = {
	en: enCommon,
	ru: ruCommon as CommonMessages,
}
