// Atlassian / Jira OAuth 2.0 (3LO). The flow lives entirely on auth.atlassian.com;
// after the token exchange we hit api.atlassian.com to enumerate the user's
// accessible cloud sites (`accessible-resources`) and pick the first one as
// the default. Site selection UX can come later — V3 ships single-site MVP.

const AUTHORIZE_URL = "https://auth.atlassian.com/authorize"
const TOKEN_URL = "https://auth.atlassian.com/oauth/token"

// Scopes needed end-to-end:
// - read:jira-work / read:jira-user — issue/comment/transition payloads
// - write:jira-work — POST /comment, POST /transitions, PUT /assignee
// - offline_access — long-lived refresh token
// - manage:jira-webhook — register Dynamic Webhooks via
//   POST /rest/api/3/webhook (used by services/jira-webhooks.ts)
export const DEFAULT_JIRA_SCOPES = [
	"read:jira-work",
	"write:jira-work",
	"read:jira-user",
	"offline_access",
	"manage:jira-webhook",
]

export interface JiraTokenResponse {
	access_token: string
	refresh_token?: string
	token_type: string
	scope: string
	expires_in: number
}

export interface JiraResource {
	id: string // cloudId — needed for every REST call
	url: string // e.g. https://acme.atlassian.net
	name: string
	scopes: string[]
}

export const buildAuthorizeUrl = (params: {
	clientId: string
	redirectUri: string
	state: string
	scopes?: string[]
}): string => {
	const qs = new URLSearchParams({
		audience: "api.atlassian.com",
		client_id: params.clientId,
		scope: (params.scopes ?? DEFAULT_JIRA_SCOPES).join(" "),
		redirect_uri: params.redirectUri,
		state: params.state,
		response_type: "code",
		prompt: "consent",
	})
	return `${AUTHORIZE_URL}?${qs.toString()}`
}

export const exchangeCodeForToken = async (params: {
	clientId: string
	clientSecret: string
	code: string
	redirectUri: string
}): Promise<JiraTokenResponse> => {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: params.clientId,
			client_secret: params.clientSecret,
			code: params.code,
			redirect_uri: params.redirectUri,
		}),
	})
	if (!res.ok) {
		throw new Error(`Jira token exchange failed: ${res.status} ${await res.text()}`)
	}
	return (await res.json()) as JiraTokenResponse
}

export const refreshAccessToken = async (params: {
	clientId: string
	clientSecret: string
	refreshToken: string
}): Promise<JiraTokenResponse> => {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: params.clientId,
			client_secret: params.clientSecret,
			refresh_token: params.refreshToken,
		}),
	})
	if (!res.ok) {
		throw new Error(`Jira token refresh failed: ${res.status} ${await res.text()}`)
	}
	return (await res.json()) as JiraTokenResponse
}

export const fetchAccessibleResources = async (accessToken: string): Promise<JiraResource[]> => {
	const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
		headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
	})
	if (!res.ok) {
		throw new Error(`Jira accessible-resources failed: ${res.status}`)
	}
	return (await res.json()) as JiraResource[]
}
