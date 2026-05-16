import nock from "nock"

const TG_HOST = "https://api.telegram.org"
const TG_PATH = /\/bot[^/]+\//
const GH = "https://api.github.com"
const GH_OAUTH = "https://github.com"
const JIRA_AUTH = "https://auth.atlassian.com"
const JIRA_API = "https://api.atlassian.com"

const tgOk = (result: unknown = true) => ({ ok: true, result })

export const mockTelegramSendMessage = (messageId = 42) =>
	nock(TG_HOST)
		.post(new RegExp(`${TG_PATH.source}sendMessage`))
		.reply(
			200,
			tgOk({
				message_id: messageId,
				date: Math.floor(Date.now() / 1000),
				chat: { id: 1, type: "private" },
				text: "Mock reply",
			}),
		)

export const mockTelegramAnswerCallbackQuery = () =>
	nock(TG_HOST)
		.post(new RegExp(`${TG_PATH.source}answerCallbackQuery`))
		.reply(200, tgOk(true))

export const mockTelegramEditMessageText = () =>
	nock(TG_HOST)
		.post(new RegExp(`${TG_PATH.source}editMessageText`))
		.reply(200, tgOk(true))

export const mockTelegramEditMessageReplyMarkup = () =>
	nock(TG_HOST)
		.post(new RegExp(`${TG_PATH.source}editMessageReplyMarkup`))
		.reply(200, tgOk(true))

export const mockTelegramSendDocument = () =>
	nock(TG_HOST)
		.post(new RegExp(`${TG_PATH.source}sendDocument`))
		.reply(200, tgOk({ message_id: 99 }))

/**
 * Persistent catch-all for any Telegram bot API call.
 * Use when the test doesn't care which Telegram methods get hit,
 * only that the code path under test runs to completion.
 */
export const mockTelegramAnyApi = () => nock(TG_HOST).post(TG_PATH).reply(200, tgOk(true)).persist()

export const mockGitHubOAuthExchange = (accessToken = "ghp_new_token") =>
	nock(GH_OAUTH).post("/login/oauth/access_token").reply(200, {
		access_token: accessToken,
		token_type: "bearer",
		scope: "repo,user:email",
	})

export const mockGitHubUserApi = (opts: { username?: string; id?: number; email?: string } = {}) =>
	nock(GH)
		.get("/user")
		.reply(200, {
			id: opts.id ?? 12345,
			login: opts.username ?? "testuser",
			email: opts.email ?? "test@example.com",
			name: "Test User",
			avatar_url: "https://github.com/testuser.png",
		})

export const mockGitHubCreateWebhook = (id = 99999) =>
	nock(GH)
		.post(/\/repos\/[^/]+\/[^/]+\/hooks/)
		.reply(201, {
			id,
			type: "Repository",
			name: "web",
			active: true,
			events: ["push", "pull_request", "issues", "issue_comment", "release", "workflow_run"],
			config: { url: "https://example.com/webhooks/github" },
		})

export const mockGitHubDeleteWebhook = () =>
	nock(GH)
		.delete(/\/repos\/[^/]+\/[^/]+\/hooks\/.+/)
		.reply(204)

export const mockGitHubPRReview = (
	state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" = "APPROVED",
) =>
	nock(GH)
		.post(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews/)
		.reply(200, {
			id: Math.floor(Math.random() * 10000),
			state,
			submitted_at: new Date().toISOString(),
		})

export const mockGitHubPRMerge = (opts: { merged?: boolean; status?: number } = {}) => {
	const merged = opts.merged ?? true
	const status = opts.status ?? (merged ? 200 : 405)
	return nock(GH)
		.put(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge/)
		.reply(
			status,
			merged
				? { sha: "abc123", merged: true, message: "Pull Request successfully merged" }
				: { message: "Pull Request is not mergeable" },
		)
}

export const mockGitHubIssueComment = () =>
	nock(GH)
		.post(/\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments/)
		.reply(201, {
			id: Math.floor(Math.random() * 10000),
			body: "test comment",
			created_at: new Date().toISOString(),
		})

export const mockGitHubPRGet = (opts: { mergeable?: boolean; state?: string } = {}) =>
	nock(GH)
		.get(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/)
		.reply(200, {
			number: 1,
			state: opts.state ?? "open",
			mergeable: opts.mergeable ?? true,
			mergeable_state: (opts.mergeable ?? true) ? "clean" : "dirty",
			title: "Test PR",
		})

export const mockJiraOAuthExchange = (accessToken = "jira_new_token") =>
	nock(JIRA_AUTH).post("/oauth/token").reply(200, {
		access_token: accessToken,
		refresh_token: "refresh_token",
		expires_in: 3600,
		scope: "read:jira-work read:jira-user write:jira-work",
	})

export const mockJiraAccessibleResources = (opts: { cloudId?: string; siteUrl?: string } = {}) =>
	nock(JIRA_API)
		.get("/oauth/token/accessible-resources")
		.reply(200, [
			{
				id: opts.cloudId ?? "test-cloud-id",
				url: opts.siteUrl ?? "https://test.atlassian.net",
				name: "test",
				scopes: ["read:jira-work", "write:jira-work"],
			},
		])

export const mockJiraMyself = () =>
	nock(JIRA_API)
		.get(/\/ex\/jira\/[^/]+\/rest\/api\/3\/myself/)
		.reply(200, {
			accountId: "jira-account-1",
			displayName: "Test User",
			emailAddress: "test@example.com",
		})

export const mockJiraTransition = () =>
	nock(JIRA_API)
		.post(/\/ex\/jira\/[^/]+\/rest\/api\/3\/issue\/[^/]+\/transitions/)
		.reply(204)

export const mockJiraAddComment = () =>
	nock(JIRA_API)
		.post(/\/ex\/jira\/[^/]+\/rest\/api\/3\/issue\/[^/]+\/comment/)
		.reply(201, { id: "10001", body: "test" })
