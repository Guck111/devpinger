import type { GithubClient } from "./client.js"

export interface PullRequestRef {
	owner: string
	repo: string
	number: number
}

export interface IssueRef {
	owner: string
	repo: string
	number: number
}

export const approvePullRequest = async (
	client: GithubClient,
	ref: PullRequestRef,
): Promise<void> => {
	await client.rest.pulls.createReview({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.number,
		event: "APPROVE",
	})
}

export const requestChangesOnPullRequest = async (
	client: GithubClient,
	ref: PullRequestRef,
	body: string,
): Promise<void> => {
	await client.rest.pulls.createReview({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.number,
		event: "REQUEST_CHANGES",
		body,
	})
}

export const commentOnPullRequest = async (
	client: GithubClient,
	ref: PullRequestRef,
	body: string,
): Promise<void> => {
	await client.rest.issues.createComment({
		owner: ref.owner,
		repo: ref.repo,
		issue_number: ref.number,
		body,
	})
}

export const replyToIssueComment = async (
	client: GithubClient,
	ref: IssueRef,
	body: string,
): Promise<void> => {
	// GitHub has no native "reply" to an issue comment; the API surface only
	// supports creating a new comment on the issue/PR thread. The "reply"
	// affordance in the bot maps to a fresh comment on the same issue.
	await client.rest.issues.createComment({
		owner: ref.owner,
		repo: ref.repo,
		issue_number: ref.number,
		body,
	})
}

export interface ReviewCommentReplyRef {
	owner: string
	repo: string
	pullNumber: number
	commentId: number
}

export const replyToReviewComment = async (
	client: GithubClient,
	ref: ReviewCommentReplyRef,
	body: string,
): Promise<void> => {
	await client.rest.pulls.createReplyForReviewComment({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.pullNumber,
		comment_id: ref.commentId,
		body,
	})
}

export const mergePullRequest = async (
	client: GithubClient,
	ref: PullRequestRef,
	options: { method?: "merge" | "squash" | "rebase" } = {},
): Promise<void> => {
	await client.rest.pulls.merge({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.number,
		merge_method: options.method ?? "squash",
	})
}

export const closeIssue = async (client: GithubClient, ref: IssueRef): Promise<void> => {
	await client.rest.issues.update({
		owner: ref.owner,
		repo: ref.repo,
		issue_number: ref.number,
		state: "closed",
	})
}

export const reopenIssue = async (client: GithubClient, ref: IssueRef): Promise<void> => {
	await client.rest.issues.update({
		owner: ref.owner,
		repo: ref.repo,
		issue_number: ref.number,
		state: "open",
	})
}

export const assignIssue = async (
	client: GithubClient,
	ref: IssueRef,
	assignees: string[],
): Promise<void> => {
	await client.rest.issues.addAssignees({
		owner: ref.owner,
		repo: ref.repo,
		issue_number: ref.number,
		assignees,
	})
}

export const getPullRequestDiff = async (
	client: GithubClient,
	ref: PullRequestRef,
): Promise<string> => {
	const res = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.number,
		mediaType: { format: "diff" },
	})
	return res.data as unknown as string
}
