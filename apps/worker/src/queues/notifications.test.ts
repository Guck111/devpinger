import { describe, expect, it } from "vitest"
import { type DeliveryDecisionEvent, decideDelivery } from "./decide-delivery.js"

const event = (overrides: Partial<DeliveryDecisionEvent> = {}): DeliveryDecisionEvent => ({
	status: "pending",
	telegramMessageId: null,
	snoozedUntil: null,
	...overrides,
})

describe("decideDelivery", () => {
	it("returns 'missing' when the event row is null", () => {
		expect(decideDelivery(null)).toBe("missing")
	})

	it("returns 'muted' when status='muted'", () => {
		expect(decideDelivery(event({ status: "muted" }))).toBe("muted")
	})

	it("returns 'still-snoozed' when snoozedUntil is in the future", () => {
		const future = new Date(2_000_000_000_000)
		const now = new Date(1_000_000_000_000)
		expect(decideDelivery(event({ snoozedUntil: future }), now)).toBe("still-snoozed")
	})

	it("returns 'deliver' when snoozedUntil is in the past (woke up)", () => {
		const past = new Date(500_000_000_000)
		const now = new Date(1_000_000_000_000)
		expect(decideDelivery(event({ snoozedUntil: past }), now)).toBe("deliver")
	})

	it("returns 'already-delivered' when telegramMessageId is set", () => {
		expect(decideDelivery(event({ telegramMessageId: 42 }))).toBe("already-delivered")
	})

	it("returns 'already-delivered' when status='delivered' even with null messageId (self-suppressed)", () => {
		expect(decideDelivery(event({ status: "delivered", telegramMessageId: null }))).toBe(
			"already-delivered",
		)
	})

	it("returns 'deliver' for a fresh pending event with no message id and no snooze", () => {
		expect(decideDelivery(event())).toBe("deliver")
	})

	it("muted has priority over already-delivered (status check wins)", () => {
		// Worker should not re-send a muted event even if it somehow has a stale
		// telegramMessageId — `muted` is checked before the messageId guard.
		expect(decideDelivery(event({ status: "muted", telegramMessageId: 42 }))).toBe("muted")
	})

	it("still-snoozed beats already-delivered", () => {
		// Snooze wake clears telegramMessageId before re-enqueue; if both signals
		// are present (race), still-snoozed wins so the worker waits.
		const future = new Date(2_000_000_000_000)
		const now = new Date(1_000_000_000_000)
		expect(
			decideDelivery(
				event({ snoozedUntil: future, telegramMessageId: 42, status: "snoozed" }),
				now,
			),
		).toBe("still-snoozed")
	})
})
