import type { Translator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"

type InlineButton = { text: string; callback_data: string }

export interface RenderedEvents {
	text: string
	keyboard: { inline_keyboard: InlineButton[][] }
}

export const renderEventsSection = (t: Translator): RenderedEvents => {
	const kb = new InlineKeyboard()
		.text(t("hubV2.events.recent"), "hub:events:recent")
		.row()
		.text(t("hubV2.events.stats"), "hub:events:stats")
		.row()
		.text(t("hubV2.events.mutes"), "hub:events:mutes")
		.row()
		.text(t("hubV2.close"), "hub:close")
	return {
		text: t("hubV2.events.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as InlineButton[][] },
	}
}
