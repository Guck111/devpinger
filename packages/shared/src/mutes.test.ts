import type { NormalizedEvent } from "@devpinger/core"
import { describe, expect, it } from "vitest"
import { type MuteRule, applyMutes } from "./mutes.js"

const baseEvent = (overrides: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
	source: "github",
	sourceEventId: "1",
	type: "pull_request.opened",
	priority: "medium",
	title: "Test PR",
	url: "https://github.com/foo/bar/pull/1",
	repo: { id: "1", name: "bar", fullName: "foo/bar", url: "https://github.com/foo/bar" },
	metadata: {},
	createdAt: new Date(0),
	...overrides,
})

const mute = (id: string, scopeType: MuteRule["scopeType"], scopeValue: string): MuteRule => ({
	id,
	scopeType,
	scopeValue,
})

describe("applyMutes", () => {
	it("returns not muted when there are no rules", () => {
		expect(applyMutes(baseEvent(), [])).toEqual({ muted: false })
	})

	it("mutes by source", () => {
		const result = applyMutes(baseEvent({ source: "github" }), [mute("m1", "source", "github")])
		expect(result.muted).toBe(true)
		expect(result.reason).toEqual({ muteId: "m1", scopeType: "source", scopeValue: "github" })
	})

	it("does not mute when source does not match", () => {
		const result = applyMutes(baseEvent({ source: "github" }), [mute("m1", "source", "jira")])
		expect(result.muted).toBe(false)
	})

	it("mutes by repo fullName", () => {
		const result = applyMutes(baseEvent(), [mute("m1", "repo", "foo/bar")])
		expect(result.muted).toBe(true)
		expect(result.reason?.scopeType).toBe("repo")
	})

	it("does not mute on partial repo match", () => {
		expect(applyMutes(baseEvent(), [mute("m1", "repo", "foo/baz")]).muted).toBe(false)
	})

	it("does not mute by repo when event has no repo", () => {
		const event = baseEvent({ repo: undefined })
		expect(applyMutes(event, [mute("m1", "repo", "foo/bar")]).muted).toBe(false)
	})

	it("mutes by Jira project key via metadata", () => {
		const event = baseEvent({ source: "jira", metadata: { projectKey: "DEV" } })
		expect(applyMutes(event, [mute("m1", "project", "DEV")]).muted).toBe(true)
	})

	it("does not mute by project when key missing", () => {
		const event = baseEvent({ source: "jira", metadata: {} })
		expect(applyMutes(event, [mute("m1", "project", "DEV")]).muted).toBe(false)
	})

	it("mutes by exact event type", () => {
		const event = baseEvent({ type: "pull_request.opened" })
		expect(applyMutes(event, [mute("m1", "event_type", "pull_request.opened")]).muted).toBe(true)
	})

	it("mutes by event type prefix", () => {
		const event = baseEvent({ type: "pull_request.opened" })
		expect(applyMutes(event, [mute("m1", "event_type", "pull_request")]).muted).toBe(true)
	})

	it("does not mute when event_type prefix does not match boundary", () => {
		const event = baseEvent({ type: "pull_request_review.submitted" })
		expect(applyMutes(event, [mute("m1", "event_type", "pull_request")]).muted).toBe(false)
	})

	it("returns the first matching rule when several apply", () => {
		const event = baseEvent({ source: "github" })
		const result = applyMutes(event, [
			mute("first", "source", "github"),
			mute("second", "repo", "foo/bar"),
		])
		expect(result.reason?.muteId).toBe("first")
	})

	it("ignores rules with mismatching scope across types", () => {
		const event = baseEvent({ source: "github" })
		const rules = [
			mute("m1", "source", "jira"),
			mute("m2", "repo", "other/repo"),
			mute("m3", "event_type", "issues"),
		]
		expect(applyMutes(event, rules).muted).toBe(false)
	})

	it("mutes Jira events via project even when repo is set", () => {
		const event = baseEvent({
			source: "jira",
			repo: { id: "p", name: "DEV", fullName: "DEV", url: "" },
			metadata: { projectKey: "DEV" },
		})
		const result = applyMutes(event, [mute("m1", "project", "DEV")])
		expect(result.muted).toBe(true)
	})

	it("ignores non-string projectKey in metadata", () => {
		const event = baseEvent({ source: "jira", metadata: { projectKey: 42 } })
		expect(applyMutes(event, [mute("m1", "project", "42")]).muted).toBe(false)
	})

	it("does not mute issue_comment by issues prefix (boundary check)", () => {
		const event = baseEvent({ type: "issue_comment" })
		expect(applyMutes(event, [mute("m1", "event_type", "issues")]).muted).toBe(false)
	})
})
