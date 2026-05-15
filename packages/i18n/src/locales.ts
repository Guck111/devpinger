export const SUPPORTED_LOCALES = ["en", "ru"] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "en"

export const LOCALE_LABEL: Record<Locale, string> = {
	en: "English",
	ru: "Русский",
}

export const isLocale = (value: unknown): value is Locale =>
	typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)

export const resolveLocale = (candidate: string | null | undefined): Locale =>
	isLocale(candidate) ? candidate : DEFAULT_LOCALE
