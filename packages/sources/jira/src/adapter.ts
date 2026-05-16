import { randomBytes } from "node:crypto"
import type {
	NormalizedEvent,
	SourceAction,
	SourceAdapter,
	SourceCredentials,
	SourceViewer,
	SubscriptionCreateResult,
	SubscriptionScope,
	WebhookLookupRequest,
	WebhookSubscriptionMatch,
} from "@devpinger/core"
import { addComment, assignIssue, listTransitions, transitionIssue } from "./actions.js"
import { createJiraClient } from "./client.js"
import { type JiraWebhookEnvelope, normalizeJiraEvent } from "./normalize.js"
import {
	buildAuthorizeUrl,
	exchangeCodeForToken,
	fetchAccessibleResources,
	refreshAccessToken as oauthRefreshAccessToken,
} from "./oauth.js"

export interface JiraAdapterConfig {
	clientId: string
	clientSecret: string
}

export interface JiraCredentials extends SourceCredentials {
	type: "oauth"
	accessToken: string
	refreshToken?: string
	expiresAt?: string
	scopes?: string[]
	jiraCloudId?: string
}

const isString = (value: unknown): value is string => typeof value === "string"

const credentialsFrom = (creds: SourceCredentials): JiraCredentials => {
	if (creds.type !== "oauth" || !isString(creds.accessToken)) {
		throw new Error("Jira adapter requires oauth credentials with accessToken")
	}
	return creds as JiraCredentials
}

const clientFor = (creds: SourceCredentials) => {
	const jira = credentialsFrom(creds)
	if (!jira.jiraCloudId) {
		throw new Error("Jira adapter requires `jiraCloudId` in credentials")
	}
	return createJiraClient({ accessToken: jira.accessToken, cloudId: jira.jiraCloudId })
}

const issueRefOf = (payload: Record<string, unknown>) => {
	const key = payload.issueIdOrKey ?? payload.issueKey ?? payload.issueId
	if (!isString(key)) throw new Error("Jira action requires `issueIdOrKey`/`issueKey`/`issueId`")
	return { issueIdOrKey: key }
}

const stringPayload = (payload: Record<string, unknown>, key: string): string => {
	const value = payload[key]
	if (!isString(value)) throw new Error(`Jira action requires \`${key}\` (string)`)
	return value
}

const buildActions = (): Record<string, SourceAction> => ({
	addComment: async (creds, payload) =>
		addComment(clientFor(creds), issueRefOf(payload), stringPayload(payload, "body")),
	transition: async (creds, payload) =>
		transitionIssue(clientFor(creds), issueRefOf(payload), {
			transitionId: stringPayload(payload, "transitionId"),
			comment: isString(payload.comment) ? payload.comment : undefined,
		}),
	assign: async (creds, payload) => {
		const accountId = payload.accountId
		if (accountId !== null && !isString(accountId)) {
			throw new Error("Jira assign requires `accountId` (string|null)")
		}
		await assignIssue(clientFor(creds), issueRefOf(payload), accountId)
	},
	listTransitions: async (creds, payload) => {
		// Returns void per SourceAction contract; transitions list is fetched
		// elsewhere via the exported helper. Kept here so server-side flows
		// can warm caches if needed.
		await listTransitions(clientFor(creds), issueRefOf(payload))
	},
})

export const createJiraAdapter = (config: JiraAdapterConfig): SourceAdapter => {
	const exchange = async (code: string, redirectUri: string): Promise<JiraCredentials> => {
		const token = await exchangeCodeForToken({
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			code,
			redirectUri,
		})
		// Pick the first accessible cloud site. Multi-site selection ships
		// in a follow-up — V1 supports one cloud per connection.
		const resources = await fetchAccessibleResources(token.access_token)
		const first = resources[0]
		return {
			type: "oauth",
			accessToken: token.access_token,
			refreshToken: token.refresh_token,
			expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
			scopes: token.scope ? token.scope.split(" ") : undefined,
			jiraCloudId: first?.id,
		}
	}

	const refresh = async (creds: SourceCredentials): Promise<JiraCredentials> => {
		const jira = credentialsFrom(creds)
		if (!jira.refreshToken) {
			throw new Error("Jira refresh requires a refreshToken")
		}
		const token = await oauthRefreshAccessToken({
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			refreshToken: jira.refreshToken,
		})
		return {
			...jira,
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? jira.refreshToken,
			expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
		}
	}

	const verifyAndNormalize = async (
		input: {
			headers: Record<string, string | string[] | undefined>
			rawBody: string
			parsedBody: unknown
		},
		lookup: (req: WebhookLookupRequest) => Promise<WebhookSubscriptionMatch | null>,
	): Promise<NormalizedEvent[]> => {
		const pathParamHeader = input.headers["x-devpinger-subscription-id"]
		const pathParam = Array.isArray(pathParamHeader) ? pathParamHeader[0] : pathParamHeader
		if (!pathParam) return []
		const match = await lookup({ pathParam })
		if (!match) return []
		const envelope = input.parsedBody as JiraWebhookEnvelope
		const event = normalizeJiraEvent({
			envelope,
			viewerAccountId: match.viewerUsername ?? null,
		})
		return event ? [event] : []
	}

	// V1: Jira webhooks are registered manually in the cloud site's admin or
	// via the `/rest/api/3/webhook` endpoint. The subscription record in
	// our DB binds (user, projectKey) — the actual provider-side webhook is
	// a single per-cloud entity rather than per-project, so create/delete
	// here only manage our DB-side notion of "watching this project".
	// We still mint a per-subscription secret: when the admin registers the
	// per-cloud webhook URL in Atlassian they include `?secret=<X>`, and
	// our route verifies that against the persisted webhookSecret to block
	// UUID-only spoof attempts.
	const subscriptionCreate = async (
		_creds: SourceCredentials,
		scope: SubscriptionScope,
	): Promise<SubscriptionCreateResult> => ({
		subscriptionId: scope.providerScopeId,
		webhookSecret: randomBytes(32).toString("base64url"),
	})

	const subscriptionDelete = async (
		_creds: SourceCredentials,
		_subscriptionId: string,
	): Promise<void> => {
		// no-op: the per-cloud webhook is managed at deploy time, not per project
	}

	const resolveViewer = async (creds: SourceCredentials): Promise<SourceViewer> => {
		const client = clientFor(creds)
		const me = await client.get<{ accountId: string; displayName: string; emailAddress?: string }>(
			"/rest/api/3/myself",
		)
		return { providerUserId: me.accountId, providerUsername: me.accountId }
	}

	const adapter: SourceAdapter = {
		id: "jira",
		displayName: "Jira",
		oauth: {
			getAuthorizationUrl: (state, redirectUri) =>
				buildAuthorizeUrl({ clientId: config.clientId, redirectUri, state }),
			exchangeCodeForToken: exchange,
			refreshAccessToken: refresh,
		},
		verifyAndNormalize,
		actions: buildActions(),
		subscriptions: {
			create: subscriptionCreate,
			delete: subscriptionDelete,
		},
		resolveViewer,
	}
	return adapter
}
