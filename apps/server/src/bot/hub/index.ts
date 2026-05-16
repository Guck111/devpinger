import { botMessages } from "@devpinger/i18n"
import type { Bot, Context } from "grammy"
import type { BotContext } from "../index.js"
import { type HubSection, isMainKeyboardText } from "./keyboard.js"

const allReplyLabels = (): string[] => {
	const out: string[] = []
	for (const locale of ["en", "ru"] as const) {
		const rk = botMessages[locale].replyKeyboard
		out.push(rk.connections, rk.events, rk.settings, rk.help)
	}
	return out
}

type SectionHandler = (ctx: BotContext) => Promise<void>

export interface HubHandlers {
	connections: SectionHandler
	events: SectionHandler
	settings: SectionHandler
	help: SectionHandler
}

export const registerHub = (bot: Bot<BotContext>, handlers: HubHandlers): void => {
	bot.hears(allReplyLabels(), async (ctx, next) => {
		const text = (ctx as Context).message?.text
		if (!text) {
			await next()
			return
		}
		const section: HubSection | null = isMainKeyboardText(text)
		if (!section) {
			await next()
			return
		}
		await handlers[section](ctx)
	})
}
