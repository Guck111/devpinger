import { Octokit } from "@octokit/rest"

export interface GithubClientOptions {
	accessToken: string
	userAgent?: string
}

export const createGithubClient = ({ accessToken, userAgent }: GithubClientOptions): Octokit =>
	new Octokit({
		auth: accessToken,
		userAgent: userAgent ?? "devpinger/0.1",
	})

export type GithubClient = Octokit
