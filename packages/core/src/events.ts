export type EventSource = "github" | "jira"

export type Priority = "high" | "medium" | "low"

export const PRIORITY_ICON: Record<Priority, string> = {
	high: "🔴",
	medium: "🟡",
	low: "🟢",
}

export type EventActionType =
	| "approve"
	| "comment"
	| "view_diff"
	| "snooze"
	| "mute_author"
	| "mute_repo"
	| "open"
	| "close"
	| "merge"
	| "assign"
	| "reopen"

export interface EventActor {
	id: string
	username: string
	displayName?: string
	avatarUrl?: string
	isBot?: boolean
}

export interface EventRepo {
	id: string
	name: string
	fullName: string
	url: string
}

export interface NormalizedEvent {
	source: EventSource
	sourceEventId: string
	type: string
	priority: Priority
	title: string
	bodyPreview?: string
	url: string
	repo?: EventRepo
	actor?: EventActor
	metadata: Record<string, unknown>
	createdAt: Date
}

export const SNOOZE_OPTIONS = [
	{ label: "1h", minutes: 60 },
	{ label: "4h", minutes: 240 },
	{ label: "tomorrow", minutes: 60 * 24 },
	{ label: "next week", minutes: 60 * 24 * 7 },
] as const

export const getEventActionLabel = (
	eventType: string,
	metadata: Record<string, unknown> | null | undefined,
	t: (key: string) => string,
): string => {
	if (eventType === "pull_request.closed") {
		const merged = (metadata as { merged?: boolean } | null | undefined)?.merged
		return merged ? t("actionLabel.prMerged") : t("actionLabel.prClosed")
	}
	if (eventType.startsWith("pull_request.")) {
		const action = eventType.slice("pull_request.".length)
		switch (action) {
			case "opened":
				return t("actionLabel.prOpened")
			case "reopened":
				return t("actionLabel.prReopened")
			case "ready_for_review":
				return t("actionLabel.prReadyForReview")
			case "review_requested":
				return t("actionLabel.prReviewRequested")
			case "synchronize":
				return t("actionLabel.prSynchronize")
			case "edited":
				return t("actionLabel.prEdited")
			case "converted_to_draft":
				return t("actionLabel.prDraft")
			case "assigned":
				return t("actionLabel.prAssigned")
			default:
				return t("actionLabel.prAction")
		}
	}
	if (eventType.startsWith("issues.")) {
		const action = eventType.slice("issues.".length)
		switch (action) {
			case "opened":
				return t("actionLabel.issueOpened")
			case "closed":
				return t("actionLabel.issueClosed")
			case "reopened":
				return t("actionLabel.issueReopened")
			default:
				return t("actionLabel.issueAction")
		}
	}
	if (eventType === "issue_comment") {
		const isPr = (metadata as { isPr?: boolean } | null | undefined)?.isPr
		return isPr ? t("actionLabel.prComment") : t("actionLabel.issueComment")
	}
	if (eventType === "pull_request_review_comment") return t("actionLabel.prReviewComment")
	if (eventType.startsWith("pull_request_review.")) {
		const state = (metadata as { state?: string } | null | undefined)?.state
		if (state === "approved") return t("actionLabel.prApproved")
		if (state === "changes_requested") return t("actionLabel.prChangesRequested")
		return t("actionLabel.prReview")
	}
	if (eventType === "workflow_run.failure") return t("actionLabel.workflowFailed")
	if (eventType === "release.published") return t("actionLabel.releasePublished")
	return ""
}

export const isTerminalEventType = (eventType: string): boolean => {
	return eventType === "pull_request.closed" || eventType === "issues.closed"
}

const SELF_SUPPRESSIBLE_PREFIXES = ["pull_request.", "issues."]
const SELF_SUPPRESSIBLE_EXACT = new Set<string>([
	"issue_comment",
	"pull_request_review_comment",
	"pull_request_review.submitted",
	"pull_request_review.edited",
])

export const isSelfSuppressibleEventType = (eventType: string): boolean => {
	if (SELF_SUPPRESSIBLE_EXACT.has(eventType)) return true
	return SELF_SUPPRESSIBLE_PREFIXES.some((prefix) => eventType.startsWith(prefix))
}
