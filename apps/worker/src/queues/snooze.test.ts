import { describe, expect, it } from "vitest"
import { type SnoozeWakeCandidate, shouldRedeliverOnWake } from "./wake-decision.js"

const candidate = (overrides: Partial<SnoozeWakeCandidate>): SnoozeWakeCandidate => ({
	status: "snoozed",
	...overrides,
})

describe("shouldRedeliverOnWake", () => {
	it("returns false when the event is missing", () => {
		expect(shouldRedeliverOnWake(null)).toBe(false)
	})

	it("returns false when the event was completed in the meantime", () => {
		expect(shouldRedeliverOnWake(candidate({ status: "completed" }))).toBe(false)
	})

	it("returns false when the event was muted in the meantime", () => {
		expect(shouldRedeliverOnWake(candidate({ status: "muted" }))).toBe(false)
	})

	it("returns true for pending status (the normal wake path)", () => {
		expect(shouldRedeliverOnWake(candidate({ status: "pending" }))).toBe(true)
	})

	it("returns true for snoozed status (snooze wake-up timer fired)", () => {
		expect(shouldRedeliverOnWake(candidate({ status: "snoozed" }))).toBe(true)
	})

	it("returns true for delivered status — wake fires re-delivery after snooze cleared messageId", () => {
		expect(shouldRedeliverOnWake(candidate({ status: "delivered" }))).toBe(true)
	})

	it("returns true when status is null (defensive)", () => {
		expect(shouldRedeliverOnWake(candidate({ status: null }))).toBe(true)
	})
})
