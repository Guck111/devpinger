import type { NormalizedEvent } from "@devpinger/core"
import { describe, expect, it } from "vitest"
import { formatEvent } from "./format.js"

const baseRepo = {
	id: "1",
	name: "repo",
	fullName: "viewer/repo",
	url: "https://github.com/viewer/repo",
}
const baseActor = { id: "9", username: "octocat" }

const mkEvent = (overrides: Partial<NormalizedEvent>): NormalizedEvent => ({
	source: "github",
	sourceEventId: "test:1",
	type: "pull_request.opened",
	priority: "medium",
	title: "viewer/repo #42: Add feature",
	url: "https://github.com/viewer/repo/pull/42",
	repo: baseRepo,
	actor: baseActor,
	bodyPreview: "Short body",
	metadata: { prNumber: 42, action: "opened" },
	createdAt: new Date("2026-05-15T12:00:00Z"),
	...overrides,
})

const callbackTargets = (rows: { callback_data?: string; url?: string }[][]): string[] =>
	rows.flat().map((b) => b.callback_data ?? `url:${b.url}`)

describe("formatEvent — github pull_request.opened", () => {
	it("renders text + default keyboard (en)", () => {
		const result = formatEvent({
			event: mkEvent({}),
			lang: "en",
			eventId: "evt-1",
		})
		expect(result.text).toMatchInlineSnapshot(`
			"🟡 🟢 PR opened
			<b>viewer/repo #42: Add feature</b>
			└─ @octocat
			└─ Short body"
		`)
		expect(callbackTargets(result.keyboard.inline_keyboard as never)).toEqual([
			"act:approve:evt-1",
			"act:comment:evt-1",
			"act:view:evt-1",
			"act:snz4h:evt-1",
			"act:snz1d:evt-1",
			"url:https://github.com/viewer/repo/pull/42",
		])
	})

	it("escapes HTML in titles and bodies", () => {
		const result = formatEvent({
			event: mkEvent({
				title: "viewer/repo #1: <script>alert(1)</script>",
				bodyPreview: "Body with <b>tags</b> & symbols",
			}),
			lang: "en",
			eventId: "evt-2",
		})
		expect(result.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
		expect(result.text).toContain("&lt;b&gt;tags&lt;/b&gt; &amp; symbols")
	})

	it("renders high-priority badge for review_requested", () => {
		const result = formatEvent({
			event: mkEvent({
				type: "pull_request.review_requested",
				priority: "high",
				metadata: { prNumber: 42, action: "review_requested" },
			}),
			lang: "en",
			eventId: "evt-3",
		})
		expect(result.text.startsWith("🔴")).toBe(true)
	})
})

describe("formatEvent — github issue_comment", () => {
	it("renders comment keyboard without approve/view", () => {
		const result = formatEvent({
			event: mkEvent({
				type: "issue_comment",
				title: "viewer/repo #7: Bug report",
				metadata: { number: 7, mentionedSelf: false, isPr: false },
			}),
			lang: "en",
			eventId: "evt-c",
		})
		expect(callbackTargets(result.keyboard.inline_keyboard as never)).toEqual([
			"act:comment:evt-c",
			"act:snz4h:evt-c",
			"url:https://github.com/viewer/repo/pull/42",
		])
	})
})

describe("formatEvent — workflow_run.failure", () => {
	it("renders snooze + mute + open keyboard", () => {
		const result = formatEvent({
			event: mkEvent({
				type: "workflow_run.failure",
				priority: "high",
				title: "CI failed: build on main",
				bodyPreview: "build step exited 1",
				metadata: { workflow: "build", branch: "main", attempt: 1 },
			}),
			lang: "en",
			eventId: "evt-ci",
		})
		expect(callbackTargets(result.keyboard.inline_keyboard as never)).toEqual([
			"act:snz1h:evt-ci",
			"act:mute:evt-ci",
			"url:https://github.com/viewer/repo/pull/42",
		])
	})
})

describe("formatEvent — jira issue", () => {
	it("renders comment + transition keyboard", () => {
		const result = formatEvent({
			event: mkEvent({
				source: "jira",
				type: "jira:issue_updated",
				title: "PROJ-123: Login broken",
				url: "https://acme.atlassian.net/browse/PROJ-123",
				repo: undefined,
				metadata: { projectKey: "PROJ", issueKey: "PROJ-123" },
			}),
			lang: "en",
			eventId: "evt-j",
		})
		expect(callbackTargets(result.keyboard.inline_keyboard as never)).toEqual([
			"act:comment:evt-j",
			"act:trans:evt-j",
			"act:snz4h:evt-j",
			"url:https://acme.atlassian.net/browse/PROJ-123",
		])
	})
})

describe("formatEvent — Telegram 4096-char cap", () => {
	it("truncates very long bodies to <= 4000 chars", () => {
		const longBody = "x".repeat(10_000)
		const longTitle = `viewer/repo #1: ${"t".repeat(2000)}`
		const result = formatEvent({
			event: mkEvent({
				title: longTitle,
				bodyPreview: longBody,
			}),
			lang: "en",
			eventId: "evt-long",
		})
		expect(result.text.length).toBeLessThanOrEqual(4000)
		expect(result.text.endsWith("…")).toBe(true)
	})
})

describe("formatEvent — Russian locale", () => {
	it("renders text in ru", () => {
		const result = formatEvent({
			event: mkEvent({}),
			lang: "ru",
			eventId: "evt-ru",
		})
		expect(result.text).toContain("<b>viewer/repo #42: Add feature</b>")
		// Default keyboard structure is identical to English — labels differ.
		expect(callbackTargets(result.keyboard.inline_keyboard as never)).toEqual([
			"act:approve:evt-ru",
			"act:comment:evt-ru",
			"act:view:evt-ru",
			"act:snz4h:evt-ru",
			"act:snz1d:evt-ru",
			"url:https://github.com/viewer/repo/pull/42",
		])
	})
})
