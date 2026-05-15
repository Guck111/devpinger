import type { NormalizedEvent, Priority } from "@devpinger/core"

// Subset of GitHub webhook headers we care about.
export interface NormalizeInput {
	eventType: string // X-GitHub-Event
	deliveryId: string // X-GitHub-Delivery
	// biome-ignore lint/suspicious/noExplicitAny: GitHub webhook payloads are dynamic; we narrow inside.
	payload: any
	viewerLogin: string // GitHub username of the connected DevPinger user
}

const SUPPORTED_EVENTS = new Set([
	"pull_request",
	"pull_request_review",
	"pull_request_review_comment",
	"issues",
	"issue_comment",
	"release",
	"workflow_run",
	"security_advisory",
])

const HIGH_PRIORITY_PR_ACTIONS = new Set(["review_requested", "ready_for_review"])
const HIGH_PRIORITY_REVIEW_STATES = new Set(["changes_requested"])

const determinePullRequestPriority = (
	action: string,
	payload: Record<string, unknown>,
): Priority => {
	if (HIGH_PRIORITY_PR_ACTIONS.has(action)) return "high"
	if (action === "closed" && (payload.pull_request as { merged?: boolean })?.merged) return "low"
	if (action === "opened" || action === "reopened") return "medium"
	return "low"
}

const determineIssuePriority = (action: string, mentionedSelf: boolean): Priority => {
	if (action === "assigned" || mentionedSelf) return "high"
	if (action === "opened") return "medium"
	return "low"
}

const isMention = (body: string | null | undefined, username: string): boolean => {
	if (!body) return false
	const handle = `@${username.toLowerCase()}`
	return body.toLowerCase().includes(handle)
}

const buildRepo = (payload: {
	repository?: { id?: number; name?: string; full_name?: string; html_url?: string }
}) => {
	const repo = payload.repository
	if (!repo?.id || !repo.full_name || !repo.html_url) return undefined
	return {
		id: String(repo.id),
		name: repo.name ?? repo.full_name,
		fullName: repo.full_name,
		url: repo.html_url,
	}
}

const buildActor = (
	sender: { id?: number; login?: string; avatar_url?: string; type?: string } | undefined,
) => {
	if (!sender?.id || !sender.login) return undefined
	return {
		id: String(sender.id),
		username: sender.login,
		avatarUrl: sender.avatar_url,
		isBot: sender.type === "Bot",
	}
}

const truncate = (s: string | null | undefined, n = 200): string | undefined => {
	if (!s) return undefined
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

export const normalizeEvent = (input: NormalizeInput): NormalizedEvent | null => {
	const { eventType, deliveryId, payload, viewerLogin } = input
	if (!SUPPORTED_EVENTS.has(eventType)) return null

	const repo = buildRepo(payload)
	const actor = buildActor(payload.sender)

	if (eventType === "pull_request") {
		const action = String(payload.action ?? "")
		const pr = payload.pull_request
		if (!pr) return null
		const priority = determinePullRequestPriority(action, payload)
		return {
			source: "github",
			sourceEventId: `${eventType}:${deliveryId}`,
			type: `pull_request.${action}`,
			priority,
			title: `${repo?.fullName ?? "?"} #${pr.number}: ${pr.title}`,
			bodyPreview: truncate(pr.body, 240),
			url: pr.html_url,
			repo,
			actor,
			metadata: {
				prNumber: pr.number,
				action,
				draft: pr.draft,
				merged: (pr as { merged?: boolean }).merged ?? false,
				additions: pr.additions,
				deletions: pr.deletions,
				changedFiles: pr.changed_files,
			},
			createdAt: new Date(),
		}
	}

	if (eventType === "pull_request_review") {
		const action = String(payload.action ?? "")
		const review = payload.review
		const pr = payload.pull_request
		if (!review || !pr) return null
		const state = String(review.state ?? "")
		const priority: Priority = HIGH_PRIORITY_REVIEW_STATES.has(state) ? "high" : "medium"
		return {
			source: "github",
			sourceEventId: `${eventType}:${deliveryId}`,
			type: `pull_request_review.${action}`,
			priority,
			title: `Review on #${pr.number}: ${pr.title}`,
			bodyPreview: truncate(review.body, 240),
			url: review.html_url,
			repo,
			actor,
			metadata: { prNumber: pr.number, state, action },
			createdAt: new Date(),
		}
	}

	if (eventType === "pull_request_review_comment" || eventType === "issue_comment") {
		const comment = payload.comment
		const issueOrPr = payload.issue ?? payload.pull_request
		if (!comment || !issueOrPr) return null
		const mentionedSelf = isMention(comment.body, viewerLogin)
		const priority: Priority = mentionedSelf ? "high" : "medium"
		// `issue_comment` fires for comments on both issues AND PRs; only PRs
		// carry a `pull_request` block on the issue payload. Capture that
		// so the formatter can show "PR comment" vs "Issue comment".
		const isPr =
			eventType === "pull_request_review_comment" ||
			Boolean((payload.issue as { pull_request?: unknown } | undefined)?.pull_request)
		return {
			source: "github",
			sourceEventId: `${eventType}:${deliveryId}`,
			type: eventType,
			priority,
			title: `${repo?.fullName ?? "?"} #${issueOrPr.number}: ${issueOrPr.title}`,
			bodyPreview: truncate(comment.body, 240),
			url: comment.html_url,
			repo,
			actor,
			metadata: { number: issueOrPr.number, mentionedSelf, isPr },
			createdAt: new Date(),
		}
	}

	if (eventType === "issues") {
		const action = String(payload.action ?? "")
		const issue = payload.issue
		if (!issue) return null
		const mentionedSelf = isMention(issue.body, viewerLogin)
		const priority = determineIssuePriority(action, mentionedSelf)
		return {
			source: "github",
			sourceEventId: `${eventType}:${deliveryId}`,
			type: `issues.${action}`,
			priority,
			title: `${repo?.fullName ?? "?"} #${issue.number}: ${issue.title}`,
			bodyPreview: truncate(issue.body, 240),
			url: issue.html_url,
			repo,
			actor,
			metadata: { issueNumber: issue.number, action, mentionedSelf },
			createdAt: new Date(),
		}
	}

	if (eventType === "release") {
		const action = String(payload.action ?? "")
		const release = payload.release
		if (!release || action !== "published") return null
		return {
			source: "github",
			sourceEventId: `${eventType}:${deliveryId}`,
			type: "release.published",
			priority: "low",
			title: `${repo?.fullName ?? "?"} ${release.tag_name}: ${release.name ?? ""}`.trim(),
			bodyPreview: truncate(release.body, 240),
			url: release.html_url,
			repo,
			actor,
			metadata: { tag: release.tag_name, prerelease: release.prerelease },
			createdAt: new Date(),
		}
	}

	if (eventType === "workflow_run") {
		const run = payload.workflow_run
		if (!run) return null
		const conclusion = String(run.conclusion ?? "")
		if (conclusion !== "failure") return null
		return {
			source: "github",
			sourceEventId: `${eventType}:${deliveryId}`,
			type: "workflow_run.failure",
			priority: run.head_branch === run.head_repository?.default_branch ? "high" : "medium",
			title: `CI failed: ${run.name} on ${run.head_branch}`,
			bodyPreview: truncate(run.display_title, 240),
			url: run.html_url,
			repo,
			actor,
			metadata: {
				workflow: run.name,
				branch: run.head_branch,
				attempt: run.run_attempt,
			},
			createdAt: new Date(),
		}
	}

	if (eventType === "security_advisory") {
		const advisory = payload.security_advisory
		if (!advisory) return null
		return {
			source: "github",
			sourceEventId: `${eventType}:${deliveryId}`,
			type: "security_advisory",
			priority: "high",
			title: `Security advisory: ${advisory.summary ?? advisory.ghsa_id ?? "unknown"}`,
			bodyPreview: truncate(advisory.description, 240),
			url: advisory.references?.[0]?.url ?? "https://github.com/security/advisories",
			repo,
			actor,
			metadata: {
				severity: advisory.severity,
				ghsaId: advisory.ghsa_id,
			},
			createdAt: new Date(),
		}
	}

	return null
}
