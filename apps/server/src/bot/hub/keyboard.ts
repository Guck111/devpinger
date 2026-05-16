import { type Translator, botMessages } from "@devpinger/i18n"
import { Keyboard } from "grammy"

export type HubSection = "connections" | "events" | "settings" | "help"

export const mainReplyKeyboard = (t: Translator): Keyboard => {
	return new Keyboard()
		.text(t("replyKeyboard.connections"))
		.text(t("replyKeyboard.events"))
		.row()
		.text(t("replyKeyboard.settings"))
		.text(t("replyKeyboard.help"))
		.resized()
		.persistent()
}

const SECTION_KEYS: HubSection[] = ["connections", "events", "settings", "help"]

let labelToSection: Map<string, HubSection> | null = null
const ensureMap = (): Map<string, HubSection> => {
	if (labelToSection) return labelToSection
	const map = new Map<string, HubSection>()
	for (const locale of ["en", "ru"] as const) {
		const rk = botMessages[locale].replyKeyboard
		for (const section of SECTION_KEYS) {
			map.set(rk[section], section)
		}
	}
	labelToSection = map
	return map
}

export const isMainKeyboardText = (text: string): HubSection | null => {
	return ensureMap().get(text) ?? null
}
