import { describe, expect, it } from "vitest"
import { normalizeEvent } from "./normalize.js"

const baseRepo = {
	id: 123,
	name: "backend",
	full_name: "acme/backend",
	html_url: "https://github.com/acme/backend",
}

const baseSender = {
	id: 42,
	login: "alice",
	avatar_url: "https://avatars.example/alice.png",
	type: "User",
}

describe("normalizeEvent (GitHub)", () => {
	it("returns null for unsupported event types", () => {
		const result = normalizeEvent({
			eventType: "ping",
			deliveryId: "abc",
			payload: {},
			viewerLogin: "arseni",
		})
		expect(result).toBeNull()
	})

	it("marks review_requested as high priority", () => {
		const result = normalizeEvent({
			eventType: "pull_request",
			deliveryId: "d1",
			viewerLogin: "arseni",
			payload: {
				action: "review_requested",
				repository: baseRepo,
				sender: baseSender,
				pull_request: {
					number: 7,
					title: "Fix auth race",
					html_url: "https://github.com/acme/backend/pull/7",
					body: "Patches the race in middleware.py",
					draft: false,
					additions: 12,
					deletions: 3,
					changed_files: 2,
				},
			},
		})
		expect(result).not.toBeNull()
		expect(result?.priority).toBe("high")
		expect(result?.type).toBe("pull_request.review_requested")
		expect(result?.title).toContain("#7")
	})

	it("flags @-mentions in comments as high priority", () => {
		const result = normalizeEvent({
			eventType: "issue_comment",
			deliveryId: "d2",
			viewerLogin: "arseni",
			payload: {
				action: "created",
				repository: baseRepo,
				sender: baseSender,
				issue: { number: 11, title: "Login broken", html_url: "..." },
				comment: {
					body: "Hey @arseni — can you take a look?",
					html_url: "https://github.com/acme/backend/issues/11#issuecomment-1",
				},
			},
		})
		expect(result?.priority).toBe("high")
		expect((result?.metadata as { mentionedSelf?: boolean }).mentionedSelf).toBe(true)
	})

	it("filters successful workflow runs", () => {
		const result = normalizeEvent({
			eventType: "workflow_run",
			deliveryId: "d3",
			viewerLogin: "arseni",
			payload: {
				action: "completed",
				repository: baseRepo,
				sender: baseSender,
				workflow_run: { conclusion: "success", name: "CI" },
			},
		})
		expect(result).toBeNull()
	})

	it("surfaces failed workflow runs", () => {
		const result = normalizeEvent({
			eventType: "workflow_run",
			deliveryId: "d4",
			viewerLogin: "arseni",
			payload: {
				action: "completed",
				repository: baseRepo,
				sender: baseSender,
				workflow_run: {
					conclusion: "failure",
					name: "CI",
					head_branch: "main",
					head_repository: { default_branch: "main" },
					html_url: "https://github.com/acme/backend/actions/runs/1",
					display_title: "Add tests",
					run_attempt: 1,
				},
			},
		})
		expect(result?.priority).toBe("high")
		expect(result?.type).toBe("workflow_run.failure")
	})
})
