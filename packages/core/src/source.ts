import type { EventSource, NormalizedEvent } from "./events.js"

export type SourceCredentialsType = "oauth"

export interface SourceCredentials {
	type: SourceCredentialsType
	[k: string]: unknown
}

export interface WebhookLookupRequest {
	secret?: string
	pathParam?: string
}

export interface WebhookSubscriptionMatch {
	userId: string
	subscriptionId: string
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
