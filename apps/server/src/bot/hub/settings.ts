import { users } from "@devpinger/db"
import type { Locale, Translator } from "@devpinger/i18n"
import { eq } from "drizzle-orm"
import { InlineKeyboard } from "grammy"
import type { db as Db } from "../../db.js"

type InlineButton = { text: string; callback_data: string }

export interface RenderedSettings {
	text: string
	keyboard: { inline_keyboard: InlineButton[][] }
}

export const renderSettingsSection = (t: Translator, currentLocale: Locale): RenderedSettings => {
	const kb = new InlineKeyboard()
		.text(t("hubV2.settings.lang", { current: currentLocale }), "hub:settings:lang")
		.row()
		.text(t("hubV2.settings.notifications"), "hub:settings:notifications")
		.row()
		.text(t("hubV2.settings.account"), "hub:settings:account")
		.row()
		.text(t("hubV2.close"), "hub:close")
	return {
		text: t("hubV2.settings.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as InlineButton[][] },
	}
}

export const renderNotificationsSubsection = (
	t: Translator,
	notifySelfActions: boolean,
): RenderedSettings => {
	const stateLabel = notifySelfActions
		? t("hubV2.notifications.selfActionsOn")
		: t("hubV2.notifications.selfActionsOff")
	const kb = new InlineKeyboard()
		.text(stateLabel, "hub:settings:notify_self:toggle")
		.row()
		.text(t("hubV2.back"), "hub:open:settings")
	return {
		text: `${t("hubV2.notifications.title")}\n\n${t("hubV2.notifications.selfActionsHint")}`,
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as InlineButton[][] },
	}
}

export const renderAccountSubsection = (t: Translator): RenderedSettings => {
	const kb = new InlineKeyboard()
		.text(t("hubV2.account.export"), "hub:settings:account:export")
		.row()
		.text(t("hubV2.account.delete"), "hub:settings:account:delete")
		.row()
		.text(t("hubV2.back"), "hub:open:settings")
	return {
		text: t("hubV2.account.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as InlineButton[][] },
	}
}

export const toggleNotifySelf = async (db: typeof Db, userId: string): Promise<boolean> => {
	const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
	if (!row) throw new Error("user not found")
	const next = !row.notifySelfActions
	await db.update(users).set({ notifySelfActions: next }).where(eq(users.id, userId))
	return next
}
