// Low-level Jira Cloud Dynamic Webhooks API.
// Docs: https://developer.atlassian.com/cloud/jira/platform/webhooks/
//
// Key constraints we encode here:
// - One POST can register multiple (events × jqlFilter) tuples sharing one URL.
//   We always register exactly one in this codebase (per-user aggregate).
// - Hard 30-day TTL: must PUT /rest/api/3/webhook/refresh before then or
//   Atlassian deletes silently.
// - Lifecycle endpoints accept a list of webhookIds and return per-id errors
//   without failing the whole request; surface failedWebhooks to callers.

import { JiraApiError, type JiraClient } from "./client.js"

// Events emitted by Atlassian we currently care about. Worklog events are
// included pre-emptively so we don't have to re-register every time we wire
// a new normalization rule.
export const DEFAULT_JIRA_WEBHOOK_EVENTS = [
	"jira:issue_created",
	"jira:issue_updated",
	"jira:issue_deleted",
	"comment_created",
	"comment_updated",
	"comment_deleted",
	"worklog_created",
	"worklog_updated",
	"worklog_deleted",
] as const

export interface JiraWebhookRegistration {
	jqlFilter: string
	events: readonly string[]
}

interface JiraWebhookCreateApiResponse {
	webhookRegistrationResult: Array<{ createdWebhookId?: number; errors?: string[] }>
}

interface JiraWebhookRefreshApiResponse {
	expirationDate?: string
	failedWebhooks?: Array<{ id: number; errors: string[] }>
}

// Project keys are uppercase alphanumeric in practice but the contract is
// looser ("any non-whitespace"); escape `"` and `\` to keep the JQL string
// well-formed even if someone names a project oddly.
const escapeProjectKey = (key: string): string => key.replace(/["\\]/g, "\\$&")

export const buildProjectJql = (projectKeys: string[]): string => {
	if (projectKeys.length === 0) {
		throw new Error("buildProjectJql requires at least one project key")
	}
	const quoted = projectKeys.map((k) => `"${escapeProjectKey(k)}"`)
	return quoted.length === 1 ? `project = ${quoted[0]}` : `project IN (${quoted.join(",")})`
}

export const createWebhook = async (
	client: JiraClient,
	params: { url: string; registrations: JiraWebhookRegistration[] },
): Promise<number[]> => {
	const body = {
		url: params.url,
		webhooks: params.registrations.map((r) => ({
			events: [...r.events],
			jqlFilter: r.jqlFilter,
		})),
	}
	const res = await client.post<JiraWebhookCreateApiResponse>("/rest/api/3/webhook", body)
	const ids: number[] = []
	const errors: string[] = []
	for (const item of res.webhookRegistrationResult ?? []) {
		if (typeof item.createdWebhookId === "number") ids.push(item.createdWebhookId)
		if (item.errors?.length) errors.push(...item.errors)
	}
	if (ids.length === 0) {
		throw new Error(
			`Jira webhook registration returned no ids${errors.length ? `: ${errors.join("; ")}` : ""}`,
		)
	}
	return ids
}

export const deleteWebhook = async (client: JiraClient, ids: number[]): Promise<void> => {
	if (ids.length === 0) return
	try {
		await client.delete<void>("/rest/api/3/webhook", { webhookIds: ids })
	} catch (err) {
		if (err instanceof JiraApiError && err.status === 404) return
		throw err
	}
}

export const refreshWebhook = async (
	client: JiraClient,
	ids: number[],
): Promise<{ refreshedIds: number[]; failedIds: number[]; expirationDate: string | null }> => {
	if (ids.length === 0) return { refreshedIds: [], failedIds: [], expirationDate: null }
	const res = await client.put<JiraWebhookRefreshApiResponse>("/rest/api/3/webhook/refresh", {
		webhookIds: ids,
	})
	const failedIds = (res.failedWebhooks ?? []).map((f) => f.id)
	const refreshedIds = ids.filter((id) => !failedIds.includes(id))
	return {
		refreshedIds,
		failedIds,
		expirationDate: res.expirationDate ?? null,
	}
}
