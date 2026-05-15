import { describe, expect, it } from "vitest"
import { type DbEventLike, dbEventToNormalized } from "./db-event-to-normalized.js"

const base = (overrides: Partial<DbEventLike> = {}): DbEventLike => ({
	id: "db-id-1",
	source: "github",
	sourceEventId: "delivery-1",
	type: "pull_request.opened",
	priority: "medium",
	title: "Test PR",
	bodyPreview: "preview text",
	url: "https://github.com/foo/bar/pull/1",
	scope: "foo/bar",
	actorUsername: "alice",
	actorId: "42",
	metadata: { prNumber: 1 },
	createdAt: new Date("2026-05-15T10:00:00Z"),
	...overrides,
})

describe("dbEventToNormalized", () => {
	it("copies the basic shape", () => {
		const ne = dbEventToNormalized(base())
		expect(ne.source).toBe("github")
		expect(ne.type).toBe("pull_request.opened")
		expect(ne.priority).toBe("medium")
		expect(ne.title).toBe("Test PR")
		expect(ne.bodyPreview).toBe("preview text")
		expect(ne.url).toBe("https://github.com/foo/bar/pull/1")
	})

	it("smuggles the DB row id into metadata.eventId for callback wiring", () => {
		const ne = dbEventToNormalized(base())
		expect((ne.metadata as { eventId?: string }).eventId).toBe("db-id-1")
	})

	it("preserves existing metadata fields alongside eventId", () => {
		const ne = dbEventToNormalized(base({ metadata: { prNumber: 7, draft: true } }))
		expect(ne.metadata).toMatchObject({ prNumber: 7, draft: true, eventId: "db-id-1" })
	})

	it("converts null bodyPreview into undefined (NormalizedEvent.bodyPreview is optional)", () => {
		const ne = dbEventToNormalized(base({ bodyPreview: null }))
		expect(ne.bodyPreview).toBeUndefined()
	})

	it("builds a synthetic repo from scope so destinations don't crash", () => {
		const ne = dbEventToNormalized(base({ scope: "acme/backend" }))
		expect(ne.repo).toEqual({
			id: "acme/backend",
			name: "acme/backend",
			fullName: "acme/backend",
			url: "https://github.com/foo/bar/pull/1",
		})
	})

	it("omits repo when scope is null", () => {
		const ne = dbEventToNormalized(base({ scope: null }))
		expect(ne.repo).toBeUndefined()
	})

	it("omits actor when actorUsername is null", () => {
		const ne = dbEventToNormalized(base({ actorUsername: null }))
		expect(ne.actor).toBeUndefined()
	})

	it("falls back actor.id to username when actorId is null", () => {
		const ne = dbEventToNormalized(base({ actorId: null }))
		expect(ne.actor?.id).toBe("alice")
		expect(ne.actor?.username).toBe("alice")
	})

	it("handles null metadata (returns object with eventId)", () => {
		const ne = dbEventToNormalized(base({ metadata: null }))
		expect(ne.metadata).toEqual({ eventId: "db-id-1" })
	})
})
