// GitHub OAuth helpers. Avoids pulling a heavy OAuth library for the
// single token-exchange call we need.

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
const TOKEN_URL = "https://github.com/login/oauth/access_token"

// Minimal scopes for V1:
// - `repo` — required for write actions (approve/comment/merge/close on
//   private repos). Drop to `public_repo` if/when we move private repo
//   support to a GitHub App with per-installation tokens.
// - `notifications` — read the user's notification stream.
// - `user:email` — for email digest opt-in.
// `read:org` was previously requested but never consumed by the codebase.
export const DEFAULT_GITHUB_SCOPES = ["repo", "notifications", "user:email"]

export interface BuildAuthorizeUrlInput {
	clientId: string
	redirectUri: string
	state: string
	scopes?: string[]
	login?: string
}

export const buildAuthorizeUrl = (input: BuildAuthorizeUrlInput): string => {
	const url = new URL(AUTHORIZE_URL)
	url.searchParams.set("client_id", input.clientId)
	url.searchParams.set("redirect_uri", input.redirectUri)
	url.searchParams.set("scope", (input.scopes ?? DEFAULT_GITHUB_SCOPES).join(" "))
	url.searchParams.set("state", input.state)
	url.searchParams.set("allow_signup", "true")
	if (input.login) url.searchParams.set("login", input.login)
	return url.toString()
}

export interface ExchangeCodeInput {
	clientId: string
	clientSecret: string
	code: string
	redirectUri: string
}

export interface GithubTokenResponse {
	accessToken: string
	tokenType: string
	scopes: string[]
	refreshToken?: string
	expiresInSeconds?: number
}

export const exchangeCodeForToken = async (
	input: ExchangeCodeInput,
): Promise<GithubTokenResponse> => {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: input.clientId,
			client_secret: input.clientSecret,
			code: input.code,
			redirect_uri: input.redirectUri,
		}).toString(),
	})
	if (!res.ok) {
		throw new Error(`GitHub token exchange failed: ${res.status} ${await res.text()}`)
	}
	const json = (await res.json()) as Record<string, unknown>
	if (typeof json.error === "string") {
		throw new Error(`GitHub token exchange error: ${json.error} ${json.error_description ?? ""}`)
	}
	const accessToken = json.access_token
	if (typeof accessToken !== "string") {
		throw new Error("GitHub token exchange returned no access_token")
	}
	const scopeStr = typeof json.scope === "string" ? json.scope : ""
	return {
		accessToken,
		tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
		scopes: scopeStr ? scopeStr.split(",") : [],
		refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
		expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : undefined,
	}
}
