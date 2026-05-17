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

	const pushPayload = (overrides: Record<string, unknown> = {}) => ({
		ref: "refs/heads/main",
		forced: false,
		compare: "https://github.com/acme/backend/compare/aaa...bbb",
		repository: { ...baseRepo, default_branch: "main" },
		sender: baseSender,
		pusher: { name: "alice", email: "alice@example.com" },
		commits: [{ id: "bbb", message: "Fix typo" }],
		head_commit: {
			id: "bbb",
			message: "Fix typo",
			committer: { username: "alice", name: "Alice" },
		},
		...overrides,
	})

	it("emits push.direct on default branch", () => {
		const result = normalizeEvent({
			eventType: "push",
			deliveryId: "d-push-1",
			viewerLogin: "arseni",
			payload: pushPayload(),
		})
		expect(result).not.toBeNull()
		expect(result?.type).toBe("push.direct")
		expect(result?.priority).toBe("medium")
		expect(result?.title).toContain("Direct push to main")
		expect(result?.title).toContain("1 commit")
		expect(result?.url).toBe("https://github.com/acme/backend/compare/aaa...bbb")
	})

	it("emits push.forced as high priority", () => {
		const result = normalizeEvent({
			eventType: "push",
			deliveryId: "d-push-2",
			viewerLogin: "arseni",
			payload: pushPayload({ forced: true }),
		})
		expect(result?.type).toBe("push.forced")
		expect(result?.priority).toBe("high")
		expect(result?.title).toContain("Force push to main")
	})

	it("ignores pushes to non-default branches", () => {
		const result = normalizeEvent({
			eventType: "push",
			deliveryId: "d-push-3",
			viewerLogin: "arseni",
			payload: pushPayload({ ref: "refs/heads/feature/foo" }),
		})
		expect(result).toBeNull()
	})

	it("ignores pushes with zero commits (branch create/delete)", () => {
		const result = normalizeEvent({
			eventType: "push",
			deliveryId: "d-push-4",
			viewerLogin: "arseni",
			payload: pushPayload({ commits: [], head_commit: null }),
		})
		expect(result).toBeNull()
	})

	it("ignores merge-commits authored by the GitHub UI (web-flow)", () => {
		const result = normalizeEvent({
			eventType: "push",
			deliveryId: "d-push-5",
			viewerLogin: "arseni",
			payload: pushPayload({
				head_commit: {
					id: "bbb",
					message: "Merge pull request #42 from acme/feature",
					committer: { username: "web-flow", name: "GitHub" },
				},
			}),
		})
		expect(result).toBeNull()
	})
})
