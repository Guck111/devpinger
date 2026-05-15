export interface DeliveryDecisionEvent {
	status: string | null
	snoozedUntil: Date | null
	telegramMessageId: number | null
}

export type DeliveryDecision =
	| "deliver"
	| "missing"
	| "muted"
	| "still-snoozed"
	| "already-delivered"

// Pure decision: should the worker actually deliver this event right now?
// Extracted from notifications.ts so unit tests don't pull in db/config.
export const decideDelivery = (
	event: DeliveryDecisionEvent | null,
	now: Date = new Date(),
): DeliveryDecision => {
	if (!event) return "missing"
	if (event.status === "muted") return "muted"
	if (event.snoozedUntil && event.snoozedUntil > now) return "still-snoozed"
	if (event.telegramMessageId !== null) return "already-delivered"
	if (event.status === "delivered") return "already-delivered"
	return "deliver"
}
