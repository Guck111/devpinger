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
import {
	type IssueRef,
	type PullRequestRef,
	type ReviewCommentReplyRef,
	approvePullRequest,
	assignIssue,
	closeIssue,
	commentOnPullRequest,
	mergePullRequest,
	reopenIssue,
	replyToIssueComment,
	replyToReviewComment,
	requestChangesOnPullRequest,
} from "./actions.js"
import { createGithubClient } from "./client.js"
import { normalizeEvent } from "./normalize.js"
import { type ExchangeCodeInput, buildAuthorizeUrl, exchangeCodeForToken } from "./oauth.js"
import { getViewer, removeRepoWebhook, setupRepoWebhook } from "./subscriptions.js"

export interface GithubAdapterConfig {
	clientId: string
	clientSecret: string
}

export interface GithubCredentials extends SourceCredentials {
	type: "oauth"
	accessToken: string
	scopes?: string[]
}

const isString = (value: unknown): value is string => typeof value === "string"

const firstHeader = (
	headers: Record<string, string | string[] | undefined>,
	name: string,
): string | undefined => {
	const v = headers[name] ?? headers[name.toLowerCase()]
	if (Array.isArray(v)) return v[0]
	return v
}

const credentialsFrom = (creds: SourceCredentials): GithubCredentials => {
	if (creds.type !== "oauth" || !isString(creds.accessToken)) {
		throw new Error("GitHub adapter requires oauth credentials with accessToken")
	}
	return creds as GithubCredentials
}

const refOf = (payload: Record<string, unknown>): { owner: string; repo: string } => {
	const repo = payload.scope as string | undefined
	if (!repo) throw new Error("GitHub action requires `scope` (owner/repo) in payload")
	const [owner, name] = repo.split("/")
	if (!owner || !name) throw new Error(`Invalid GitHub scope: ${repo}`)
	return { owner, repo: name }
}

const pullRequestRefOf = (payload: Record<string, unknown>): PullRequestRef => {
	const { owner, repo } = refOf(payload)
	const number = Number(payload.number)
	if (!Number.isFinite(number)) throw new Error("GitHub action requires numeric `number`")
	return { owner, repo, number }
}

const issueRefOf = (payload: Record<string, unknown>): IssueRef => pullRequestRefOf(payload)

const reviewCommentRefOf = (payload: Record<string, unknown>): ReviewCommentReplyRef => {
	const { owner, repo } = refOf(payload)
	const pullNumber = Number(payload.pullNumber)
	const commentId = Number(payload.commentId)
	if (!Number.isFinite(pullNumber) || !Number.isFinite(commentId)) {
		throw new Error("GitHub replyToReviewComment requires `pullNumber` and `commentId`")
	}
	return { owner, repo, pullNumber, commentId }
}

const stringPayload = (payload: Record<string, unknown>, key: string): string => {
	const value = payload[key]
	if (!isString(value)) throw new Error(`GitHub action requires \`${key}\` (string)`)
	return value
}

const clientFor = (creds: SourceCredentials) =>
	createGithubClient({ accessToken: credentialsFrom(creds).accessToken })

const buildActions = (): Record<string, SourceAction> => ({
	approve: async (creds, payload) =>
		approvePullRequest(clientFor(creds), pullRequestRefOf(payload)),
	requestChanges: async (creds, payload) =>
		requestChangesOnPullRequest(
			clientFor(creds),
			pullRequestRefOf(payload),
			stringPayload(payload, "body"),
		),
	comment: async (creds, payload) =>
		commentOnPullRequest(
			clientFor(creds),
			pullRequestRefOf(payload),
			stringPayload(payload, "body"),
		),
	replyToIssueComment: async (creds, payload) =>
		replyToIssueComment(clientFor(creds), issueRefOf(payload), stringPayload(payload, "body")),
	replyToReviewComment: async (creds, payload) =>
		replyToReviewComment(
			clientFor(creds),
			reviewCommentRefOf(payload),
			stringPayload(payload, "body"),
		),
	merge: async (creds, payload) => {
		const method = payload.method
		const mergeMethod =
			method === "merge" || method === "squash" || method === "rebase" ? method : undefined
		await mergePullRequest(clientFor(creds), pullRequestRefOf(payload), { method: mergeMethod })
	},
	closeIssue: async (creds, payload) => closeIssue(clientFor(creds), issueRefOf(payload)),
	reopenIssue: async (creds, payload) => reopenIssue(clientFor(creds), issueRefOf(payload)),
	assignIssue: async (creds, payload) => {
		const assignees = payload.assignees
		if (!Array.isArray(assignees) || !assignees.every(isString)) {
			throw new Error("GitHub assignIssue requires `assignees: string[]`")
		}
		await assignIssue(clientFor(creds), issueRefOf(payload), assignees)
	},
})

export const createGithubAdapter = (config: GithubAdapterConfig): SourceAdapter => {
	const exchange = async (code: string, redirectUri: string): Promise<GithubCredentials> => {
		const input: ExchangeCodeInput = {
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			code,
			redirectUri,
		}
		const token = await exchangeCodeForToken(input)
		return { type: "oauth", accessToken: token.accessToken, scopes: token.scopes }
	}

	const verifyAndNormalize = async (
		input: {
			headers: Record<string, string | string[] | undefined>
			rawBody: string
			parsedBody: unknown
		},
		lookup: (req: WebhookLookupRequest) => Promise<WebhookSubscriptionMatch | null>,
	): Promise<NormalizedEvent[]> => {
		const signature = firstHeader(input.headers, "x-hub-signature-256")
		const eventType = firstHeader(input.headers, "x-github-event")
		const deliveryId = firstHeader(input.headers, "x-github-delivery")
		if (!signature || !eventType || !deliveryId) return []
		const match = await lookup({ signature, rawBody: input.rawBody })
		if (!match) return []
		const event = normalizeEvent({
			eventType,
			deliveryId,
			payload: input.parsedBody,
			viewerLogin: match.viewerUsername ?? "",
		})
		return event ? [event] : []
	}

	const subscriptionCreate = async (
		creds: SourceCredentials,
		scope: SubscriptionScope,
	): Promise<SubscriptionCreateResult> => {
		const [owner, repo] = scope.providerScopeId.split("/")
		if (!owner || !repo) {
			throw new Error(`Invalid GitHub scope: ${scope.providerScopeId}`)
		}
		const webhookSecret = randomBytes(32).toString("hex")
		const result = await setupRepoWebhook(clientFor(creds), {
			owner,
			repo,
			url: scope.callbackUrl,
			secret: webhookSecret,
		})
		return { subscriptionId: String(result.id), webhookSecret }
	}

	const subscriptionDelete = async (
		_creds: SourceCredentials,
		subscriptionId: string,
	): Promise<void> => {
		const hookId = Number(subscriptionId)
		if (!Number.isFinite(hookId)) throw new Error(`Invalid GitHub hook id: ${subscriptionId}`)
		// Server passes provider_scope_id alongside subscription id; we accept
		// the canonical "owner/repo:hookId" composite shape too.
		// In V1 we only have the bare hook id here — the server must call
		// `delete` with extra context (TBD by server). For now, this throws
		// when scope isn't available, surfacing the gap to the integrator.
		throw new Error(`GitHub webhook delete requires owner/repo context (hookId=${hookId})`)
	}

	const subscriptionDeleteWithScope = async (
		creds: SourceCredentials,
		scope: { providerScopeId: string; subscriptionId: string },
	): Promise<void> => {
		const [owner, repo] = scope.providerScopeId.split("/")
		const hookId = Number(scope.subscriptionId)
		if (!owner || !repo || !Number.isFinite(hookId)) {
			throw new Error(
				`Invalid GitHub delete args: ${scope.providerScopeId}/${scope.subscriptionId}`,
			)
		}
		await removeRepoWebhook(clientFor(creds), { owner, repo, hookId })
	}

	const resolveViewer = async (creds: SourceCredentials): Promise<SourceViewer> => {
		const viewer = await getViewer(clientFor(creds))
		return { providerUserId: String(viewer.id), providerUsername: viewer.login }
	}

	const adapter: SourceAdapter & {
		subscriptionDeleteWithScope: typeof subscriptionDeleteWithScope
	} = {
		id: "github",
		displayName: "GitHub",
		oauth: {
			getAuthorizationUrl: (state, redirectUri) =>
				buildAuthorizeUrl({
					clientId: config.clientId,
					redirectUri,
					state,
				}),
			exchangeCodeForToken: exchange,
		},
		verifyAndNormalize,
		actions: buildActions(),
		subscriptions: {
			create: subscriptionCreate,
			delete: subscriptionDelete,
		},
		resolveViewer,
		subscriptionDeleteWithScope,
	}
	return adapter
}
