import type { NormalizedEvent } from "@devpinger/core"

export interface DbEventLike {
	id: string
	source: "github" | "jira"
	sourceEventId: string
	type: string
	priority: "high" | "medium" | "low"
	title: string
	bodyPreview: string | null
	url: string
	scope: string | null
	actorUsername: string | null
	actorId: string | null
	metadata: unknown
	createdAt: Date
}

// Reconstruct a NormalizedEvent from a persisted row, including
// the DB row id under metadata.eventId so destination adapters can
// build deep-links / callback ids against the canonical id.
export const dbEventToNormalized = (event: DbEventLike): NormalizedEvent => {
	const metadata = (event.metadata as Record<string, unknown> | null) ?? {}
	return {
		source: event.source,
		sourceEventId: event.sourceEventId,
		type: event.type,
		priority: event.priority,
		title: event.title,
		bodyPreview: event.bodyPreview ?? undefined,
		url: event.url,
		repo: event.scope
			? { id: event.scope, name: event.scope, fullName: event.scope, url: event.url }
			: undefined,
		actor: event.actorUsername
			? { id: event.actorId ?? event.actorUsername, username: event.actorUsername }
			: undefined,
		metadata: { ...metadata, eventId: event.id },
		createdAt: event.createdAt,
	}
}
