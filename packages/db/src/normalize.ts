import type { NormalizedEvent } from "@devpinger/core"

// Minimal shape we read off a persisted `events` row. Kept here (not in
// schema/events.ts) so callers don't have to import drizzle inferred types
// just to talk to this helper.
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

// Reconstruct a NormalizedEvent from a persisted row. The DB row id is
// smuggled into metadata.eventId so destination adapters can build deep-
// links / callback ids against the canonical id without a second lookup.
//
// Single source of truth: both apps/server (bot deep-link rendering) and
// apps/worker (notifications queue handler) import this. Don't add a
// per-app fork.
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
