import type { Locale } from "@devpinger/i18n"
import { isLocale } from "@devpinger/i18n"
import type { Context } from "grammy"
import { db } from "../db.js"
import { getUserByTelegramId } from "../services/users.js"

export const dbLocaleResolver = async (ctx: Context): Promise<Locale | null> => {
	const telegramId = ctx.from?.id
	if (!telegramId) return null
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return null
	return isLocale(user.lang) ? user.lang : null
}
