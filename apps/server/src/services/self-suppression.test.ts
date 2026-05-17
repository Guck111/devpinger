import type { NormalizedEvent } from "@devpinger/core"
import type { ConnectionCredentialsPayload } from "@devpinger/db"
import { describe, expect, it } from "vitest"
import type { ResolvedConnection } from "./connections.js"
import { isUserOwnEvent, shouldSuppressForSelf } from "./self-suppression.js"

const baseEvent = (overrides: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
	source: "github",
	sourceEventId: "1",
	type: "pull_request.opened",
	priority: "medium",
	title: "Test",
	url: "https://github.com/foo/bar/pull/1",
	repo: { id: "1", name: "bar", fullName: "foo/bar", url: "https://github.com/foo/bar" },
	actor: { id: "42", username: "alice" },
	metadata: {},
	createdAt: new Date(0),
	...overrides,
})

const connection = (
	provider: "github" | "jira",
	overrides: Partial<ResolvedConnection> = {},
): ResolvedConnection => ({
	id: "c1",
	userId: "u1",
	provider,
	providerUserId: "42",
	providerUsername: "alice",
	credentials: { type: "oauth", accessToken: "tok" } as ConnectionCredentialsPayload,
	...overrides,
})

describe("isUserOwnEvent", () => {
	it("returns false when there is no connection", () => {
		expect(isUserOwnEvent(baseEvent(), null)).toBe(false)
	})

	it("returns false when the event type is not self-suppressible", () => {
		const event = baseEvent({
			type: "workflow_run.failure",
			actor: { id: "42", username: "alice" },
		})
		expect(isUserOwnEvent(event, connection("github"))).toBe(false)
	})

	it("returns true for github events triggered by the connected user (case-insensitive)", () => {
		const event = baseEvent({ actor: { id: "42", username: "ALICE" } })
		expect(isUserOwnEvent(event, connection("github", { providerUsername: "alice" }))).toBe(true)
	})

	it("returns false for github events triggered by a different login", () => {
		const event = baseEvent({ actor: { id: "99", username: "bob" } })
		expect(isUserOwnEvent(event, connection("github"))).toBe(false)
	})

	it("returns false for github events when the actor has no username", () => {
		const event = baseEvent({ actor: undefined })
		expect(isUserOwnEvent(event, connection("github"))).toBe(false)
	})

	it("returns true for jira events whose actor.id matches the providerUserId (accountId)", () => {
		const event = baseEvent({
			source: "jira",
			type: "jira:issue_updated",
			actor: { id: "viewer-abc", username: "viewer_name" },
		})
		expect(
			isUserOwnEvent(
				event,
				connection("jira", { providerUserId: "viewer-abc", providerUsername: "viewer" }),
			),
		).toBe(true)
	})

	it("returns false for jira events whose actor.id is different", () => {
		const event = baseEvent({
			source: "jira",
			type: "comment_created",
			actor: { id: "someone-else", username: "x" },
		})
		expect(isUserOwnEvent(event, connection("jira", { providerUserId: "viewer-abc" }))).toBe(false)
	})

	it("issue_comment is self-suppressible (exact match in the set)", () => {
		const event = baseEvent({ type: "issue_comment", actor: { id: "42", username: "alice" } })
		expect(isUserOwnEvent(event, connection("github"))).toBe(true)
	})

	it("pull_request_review_comment is self-suppressible", () => {
		const event = baseEvent({
			type: "pull_request_review_comment",
			actor: { id: "42", username: "alice" },
		})
		expect(isUserOwnEvent(event, connection("github"))).toBe(true)
	})

	it("pull_request_review.submitted is self-suppressible (exact match)", () => {
		const event = baseEvent({
			type: "pull_request_review.submitted",
			actor: { id: "42", username: "alice" },
		})
		expect(isUserOwnEvent(event, connection("github"))).toBe(true)
	})

	it("release.published is NOT self-suppressible", () => {
		const event = baseEvent({
			type: "release.published",
			actor: { id: "42", username: "alice" },
		})
		expect(isUserOwnEvent(event, connection("github"))).toBe(false)
	})

	it("jira:issue_created is NEVER self-suppressible — task-inbox signal even when self-assigned", () => {
		const event = baseEvent({
			source: "jira",
			type: "jira:issue_created",
			actor: { id: "viewer-abc", username: "viewer" },
		})
		expect(isUserOwnEvent(event, connection("jira", { providerUserId: "viewer-abc" }))).toBe(false)
	})
})

describe("shouldSuppressForSelf", () => {
	it("returns false when notifySelfActions is true (user opted in to everything)", () => {
		const event = baseEvent({ actor: { id: "42", username: "alice" } })
		expect(
			shouldSuppressForSelf({ event, connection: connection("github"), notifySelfActions: true }),
		).toBe(false)
	})

	it("suppresses self-events when notifySelfActions is false", () => {
		const event = baseEvent({ actor: { id: "42", username: "alice" } })
		expect(
			shouldSuppressForSelf({ event, connection: connection("github"), notifySelfActions: false }),
		).toBe(true)
	})

	it("does not suppress someone else's event even with notifySelfActions=false", () => {
		const event = baseEvent({ actor: { id: "99", username: "bob" } })
		expect(
			shouldSuppressForSelf({ event, connection: connection("github"), notifySelfActions: false }),
		).toBe(false)
	})

	it("does not suppress when connection is missing (no way to identify self)", () => {
		expect(
			shouldSuppressForSelf({ event: baseEvent(), connection: null, notifySelfActions: false }),
		).toBe(false)
	})
})
