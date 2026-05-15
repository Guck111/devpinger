import {
	type BotMessages,
	DEFAULT_LOCALE,
	type Locale,
	type Messages,
	type Translator,
	botMessages,
	createTranslator,
	resolveLocale,
} from "@devpinger/i18n"
import type { Context, MiddlewareFn } from "grammy"

export interface I18nFlavor {
	t: Translator
	locale: Locale
}

export type LocaleResolver = (ctx: Context) => Promise<Locale | null> | Locale | null

const translatorCache = new Map<Locale, Translator>()

const getTranslator = (locale: Locale): Translator => {
	let cached = translatorCache.get(locale)
	if (!cached) {
		cached = createTranslator(botMessages[locale] as unknown as Messages)
		translatorCache.set(locale, cached)
	}
	return cached
}

const detectFromTelegram = (ctx: Context): Locale | null => {
	const tag = ctx.from?.language_code?.toLowerCase()
	if (!tag) return null
	if (tag === "ru" || tag.startsWith("ru-")) return "ru"
	if (tag === "en" || tag.startsWith("en-")) return "en"
	return null
}

export const createI18nMiddleware = (resolver?: LocaleResolver): MiddlewareFn<Context> => {
	return async (ctx, next) => {
		const fromResolver = resolver ? await resolver(ctx) : null
		const fromTelegram = detectFromTelegram(ctx)
		const locale = resolveLocale(fromResolver ?? fromTelegram ?? DEFAULT_LOCALE)
		const t = getTranslator(locale)
		const flavored = ctx as Context & I18nFlavor
		flavored.t = t
		flavored.locale = locale
		await next()
	}
}

export type { BotMessages }
