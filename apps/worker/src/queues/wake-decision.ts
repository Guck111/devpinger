export interface SnoozeWakeCandidate {
	status: "pending" | "delivered" | "snoozed" | "muted" | "completed" | "failed" | null
}

// Pure decision: when a snooze timer fires, do we still want to ping the user?
// Skip if the event is gone, completed, muted, or marked failed (e.g. user
// blocked the bot) between snooze and wake.
export const shouldRedeliverOnWake = (event: SnoozeWakeCandidate | null): boolean => {
	if (!event) return false
	if (event.status === "completed") return false
	if (event.status === "muted") return false
	if (event.status === "failed") return false
	return true
}
