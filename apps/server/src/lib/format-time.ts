import type { Locale } from "@devpinger/i18n"

const VALID_TIMEZONE = (tz: string | undefined): string => {
	if (!tz) return "UTC"
	try {
		new Intl.DateTimeFormat("en", { timeZone: tz })
		return tz
	} catch {
		return "UTC"
	}
}

// Render `until` as "HH:MM" if it's today in the user's timezone, otherwise
// as "DD Mon HH:MM". Falls back to UTC if the timezone string is bogus.
export const formatSnoozeUntil = (
	until: Date,
	locale: Locale,
	timezone: string | undefined,
	now: Date = new Date(),
): string => {
	const tz = VALID_TIMEZONE(timezone)
	const sameDay =
		new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "short" }).format(until) ===
		new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "short" }).format(now)
	if (sameDay) {
		return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
			timeZone: tz,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).format(until)
	}
	return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
		timeZone: tz,
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(until)
}
