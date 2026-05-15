// Thin REST client wrapper for Jira Cloud. Every request goes through
// `https://api.atlassian.com/ex/jira/{cloudId}` with a Bearer access token
// (Atlassian OAuth 2.0 3LO). On 401 the caller is expected to refresh the
// access token and retry — that recovery loop lives in the server, not here.

export interface JiraClientOptions {
	accessToken: string
	cloudId: string
	userAgent?: string
}

export class JiraApiError extends Error {
	readonly status: number
	readonly body: string

	constructor(status: number, body: string) {
		super(`Jira API ${status}: ${body.slice(0, 200)}`)
		this.status = status
		this.body = body
	}
}

const baseUrl = (cloudId: string) => `https://api.atlassian.com/ex/jira/${cloudId}`

export const createJiraClient = ({ accessToken, cloudId, userAgent }: JiraClientOptions) => {
	const headers: Record<string, string> = {
		authorization: `Bearer ${accessToken}`,
		accept: "application/json",
		"user-agent": userAgent ?? "devpinger/0.1",
	}

	const request = async <T>(
		method: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		body?: unknown,
	): Promise<T> => {
		const url = `${baseUrl(cloudId)}${path.startsWith("/") ? path : `/${path}`}`
		const init: RequestInit = { method, headers: { ...headers } }
		if (body !== undefined) {
			;(init.headers as Record<string, string>)["content-type"] = "application/json"
			init.body = JSON.stringify(body)
		}
		const res = await fetch(url, init)
		if (!res.ok) {
			throw new JiraApiError(res.status, await res.text())
		}
		if (res.status === 204) return undefined as T
		const contentType = res.headers.get("content-type") ?? ""
		if (!contentType.includes("application/json")) return undefined as T
		return (await res.json()) as T
	}

	return {
		cloudId,
		get: <T>(path: string) => request<T>("GET", path),
		post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
		put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
		delete: <T>(path: string) => request<T>("DELETE", path),
	}
}

export type JiraClient = ReturnType<typeof createJiraClient>
