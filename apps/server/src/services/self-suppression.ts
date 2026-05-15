import type { NormalizedEvent } from "@devpinger/core"
import { isSelfSuppressibleEventType } from "@devpinger/core"
import type { ResolvedConnection } from "./connections.js"

// "Did this event come from the user themselves?" — used to drop redundant
// echoes of the user's own actions (PR open/close/merge they did, comments
// they wrote). Only fires for event types in the self-suppressible set; all
// others pass through.
export const isUserOwnEvent = (
	event: NormalizedEvent,
	connection: ResolvedConnection | null,
): boolean => {
	if (!connection) return false
	if (!isSelfSuppressibleEventType(event.type)) return false
	if (event.source === "github") {
		const login = connection.providerUsername?.toLowerCase()
		return Boolean(login && event.actor?.username?.toLowerCase() === login)
	}
	if (event.source === "jira") {
		const accountId = connection.providerUserId
		return Boolean(accountId && event.actor?.id === accountId)
	}
	return false
}

export interface SelfSuppressionInput {
	event: NormalizedEvent
	connection: ResolvedConnection | null
	notifySelfActions: boolean
}

export const shouldSuppressForSelf = (input: SelfSuppressionInput): boolean => {
	if (input.notifySelfActions) return false
	return isUserOwnEvent(input.event, input.connection)
}
