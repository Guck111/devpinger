import type { GithubClient } from "./client.js"

export interface WebhookSetupInput {
	owner: string
	repo: string
	url: string
	secret: string
}

export interface WebhookSetupResult {
	id: number
}

// security_advisory is intentionally NOT here — GitHub only allows that
// event on App-level webhooks, not the repo-level OAuth webhooks we create.
const WEBHOOK_EVENTS = [
	"pull_request",
	"pull_request_review",
	"pull_request_review_comment",
	"issues",
	"issue_comment",
	"release",
	"workflow_run",
	"push",
]

export const setupRepoWebhook = async (
	client: GithubClient,
	input: WebhookSetupInput,
): Promise<WebhookSetupResult> => {
	const res = await client.rest.repos.createWebhook({
		owner: input.owner,
		repo: input.repo,
		active: true,
		events: WEBHOOK_EVENTS,
		config: {
			url: input.url,
			content_type: "json",
			secret: input.secret,
			insecure_ssl: "0",
		},
	})
	return { id: res.data.id }
}

export const removeRepoWebhook = async (
	client: GithubClient,
	input: { owner: string; repo: string; hookId: number },
): Promise<void> => {
	await client.rest.repos.deleteWebhook({
		owner: input.owner,
		repo: input.repo,
		hook_id: input.hookId,
	})
}

export interface GithubRepoSummary {
	id: number
	name: string
	fullName: string
	private: boolean
	htmlUrl: string
	defaultBranch: string
	updatedAt: string | null
	starred?: boolean
}

export const listAccessibleRepos = async (
	client: GithubClient,
	options: { starred?: boolean; perPage?: number; page?: number } = {},
): Promise<GithubRepoSummary[]> => {
	if (options.starred) {
		const res = await client.rest.activity.listReposStarredByAuthenticatedUser({
			per_page: options.perPage ?? 30,
			page: options.page ?? 1,
		})
		return res.data.map((r) => ({
			id: r.id,
			name: r.name,
			fullName: r.full_name,
			private: r.private,
			htmlUrl: r.html_url,
			defaultBranch: r.default_branch ?? "main",
			updatedAt: r.updated_at,
			starred: true,
		}))
	}
	const res = await client.rest.repos.listForAuthenticatedUser({
		sort: "updated",
		per_page: options.perPage ?? 30,
		page: options.page ?? 1,
		affiliation: "owner,collaborator,organization_member",
	})
	return res.data.map((r) => ({
		id: r.id,
		name: r.name,
		fullName: r.full_name,
		private: r.private,
		htmlUrl: r.html_url,
		defaultBranch: r.default_branch ?? "main",
		updatedAt: r.updated_at,
	}))
}

export interface GithubViewer {
	id: number
	login: string
	name: string | null
	avatarUrl: string
}

export const getViewer = async (client: GithubClient): Promise<GithubViewer> => {
	const res = await client.rest.users.getAuthenticated()
	return {
		id: res.data.id,
		login: res.data.login,
		name: res.data.name,
		avatarUrl: res.data.avatar_url,
	}
}
