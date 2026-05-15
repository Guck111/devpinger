import { describe, expect, it } from "vitest"
import { formatSnoozeUntil } from "./format-time.js"

const NOW = new Date("2026-05-15T10:00:00Z")

describe("formatSnoozeUntil", () => {
	it("renders HH:MM when until is later the same day in user timezone (UTC)", () => {
		const until = new Date("2026-05-15T14:30:00Z")
		expect(formatSnoozeUntil(until, "en", "UTC", NOW)).toBe("14:30")
	})

	it("renders day+month+time when until is on a different day", () => {
		const until = new Date("2026-05-16T08:00:00Z")
		const out = formatSnoozeUntil(until, "en", "UTC", NOW)
		// Format varies slightly by ICU version (May vs May), so check structural pieces.
		expect(out).toMatch(/\b16\b/)
		expect(out).toMatch(/08:00/)
	})

	it("respects a non-UTC user timezone for the same-day check", () => {
		// 23:30 UTC on 2026-05-15 is 01:30 next-day in Europe/Moscow (UTC+3).
		const until = new Date("2026-05-15T22:30:00Z")
		const ru = formatSnoozeUntil(until, "ru", "Europe/Moscow", NOW)
		// In Moscow the wakeup is on 2026-05-16 at 01:30 — not same day → has month.
		expect(ru).toMatch(/01:30/)
		expect(ru).not.toBe("01:30")
	})

	it("falls back to UTC when timezone string is bogus", () => {
		const until = new Date("2026-05-15T14:30:00Z")
		expect(formatSnoozeUntil(until, "en", "Not/A/Real/Zone", NOW)).toBe("14:30")
	})

	it("handles undefined timezone (defaults to UTC)", () => {
		const until = new Date("2026-05-15T14:30:00Z")
		expect(formatSnoozeUntil(until, "en", undefined, NOW)).toBe("14:30")
	})

	it("uses 24-hour clock for English locale", () => {
		const until = new Date("2026-05-15T20:30:00Z")
		const out = formatSnoozeUntil(until, "en", "UTC", NOW)
		expect(out).toBe("20:30")
	})
})
