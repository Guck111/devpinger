import { retry } from "@octokit/plugin-retry"
import { Octokit } from "@octokit/rest"

const OctokitWithRetry = Octokit.plugin(retry)

export interface GithubClientOptions {
	accessToken: string
	userAgent?: string
}

// Octokit retries 5xx and secondary rate-limit errors by default
// (3 attempts, exponential backoff). 4xx auth errors are NOT retried —
// they bubble up immediately so we can surface "reconnect" prompts.
export const createGithubClient = ({ accessToken, userAgent }: GithubClientOptions): Octokit =>
	new OctokitWithRetry({
		auth: accessToken,
		userAgent: userAgent ?? "devpinger/0.1",
		request: { retries: 3 },
	})

export type GithubClient = Octokit
