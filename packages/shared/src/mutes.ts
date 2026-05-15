import type { EventSource, NormalizedEvent } from "@devpinger/core"

export type MuteScopeType = "source" | "repo" | "project" | "event_type"

export interface MuteRule {
	id: string
	scopeType: MuteScopeType
	scopeValue: string
}

export interface MuteReason {
	muteId: string
	scopeType: MuteScopeType
	scopeValue: string
}

export interface MuteResult {
	muted: boolean
	reason?: MuteReason
}

const eventTypeMatches = (eventType: string, scope: string): boolean => {
	if (eventType === scope) return true
	return eventType.startsWith(`${scope}.`)
}

const projectKeyOf = (event: NormalizedEvent): string | undefined => {
	const raw = (event.metadata as { projectKey?: unknown } | null | undefined)?.projectKey
	return typeof raw === "string" ? raw : undefined
}

const muteMatches = (mute: MuteRule, event: NormalizedEvent): boolean => {
	switch (mute.scopeType) {
		case "source":
			return mute.scopeValue === (event.source as EventSource)
		case "repo":
			return mute.scopeValue === event.repo?.fullName
		case "project":
			return mute.scopeValue === projectKeyOf(event)
		case "event_type":
			return eventTypeMatches(event.type, mute.scopeValue)
	}
}

export const applyMutes = (event: NormalizedEvent, mutes: MuteRule[]): MuteResult => {
	for (const mute of mutes) {
		if (muteMatches(mute, event)) {
			return {
				muted: true,
				reason: {
					muteId: mute.id,
					scopeType: mute.scopeType,
					scopeValue: mute.scopeValue,
				},
			}
		}
	}
	return { muted: false }
}
