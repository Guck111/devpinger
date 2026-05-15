import type { EventSource, NormalizedEvent } from "./events.js"

export type SourceCredentialsType = "oauth"

export interface SourceCredentials {
	type: SourceCredentialsType
	[k: string]: unknown
}

// What an adapter passes to the server's subscription resolver to find the
// owning user/subscription for an inbound webhook. GitHub-style adapters
// pass `signature` + `rawBody` and the server iterates active
// subscriptions, computing HMAC for each. Jira-style adapters embed the
// subscription id in the webhook URL path and pass `pathParam` instead.
export interface WebhookLookupRequest {
	signature?: string
	rawBody?: string
	pathParam?: string
}

export interface WebhookSubscriptionMatch {
	userId: string
	subscriptionId: string
	// Provider username of the connected user (e.g. GitHub login or Atlassian
	// account id). Adapters use this for self-mention detection during
	// normalize. Optional because not all adapters need it.
	viewerUsername?: string
}

export interface SourceWebhookInput {
	headers: Record<string, string | string[] | undefined>
	rawBody: string
	parsedBody: unknown
}

export interface SubscriptionScope {
	providerScopeId: string
	callbackUrl: string
}

export interface SubscriptionCreateResult {
	subscriptionId: string
	webhookSecret?: string
}

export interface SourceViewer {
	providerUserId: string
	providerUsername: string
}

export type SourceAction = (
	credentials: SourceCredentials,
	payload: Record<string, unknown>,
) => Promise<void>

export interface SourceAdapter {
	readonly id: EventSource
	readonly displayName: string

	oauth: {
		getAuthorizationUrl(state: string, redirectUri: string): string
		exchangeCodeForToken(code: string, redirectUri: string): Promise<SourceCredentials>
		refreshAccessToken?(credentials: SourceCredentials): Promise<SourceCredentials>
	}

	verifyAndNormalize(
		input: SourceWebhookInput,
		lookupSubscriptionByWebhook: (
			req: WebhookLookupRequest,
		) => Promise<WebhookSubscriptionMatch | null>,
	): Promise<NormalizedEvent[]>

	actions: Record<string, SourceAction>

	subscriptions: {
		create(
			credentials: SourceCredentials,
			scope: SubscriptionScope,
		): Promise<SubscriptionCreateResult>
		delete(credentials: SourceCredentials, subscriptionId: string): Promise<void>
	}

	resolveViewer(credentials: SourceCredentials): Promise<SourceViewer>
}
