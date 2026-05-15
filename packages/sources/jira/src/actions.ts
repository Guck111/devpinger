import type { JiraClient } from "./client.js"

export interface IssueRef {
	issueIdOrKey: string
}

// Plain-text body is wrapped into a minimal ADF "paragraph" document so the
// REST API accepts it without the caller building ADF by hand.
const adfFromText = (text: string) => ({
	type: "doc",
	version: 1,
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text }],
		},
	],
})

export const addComment = async (
	client: JiraClient,
	ref: IssueRef,
	body: string,
): Promise<void> => {
	await client.post(`/rest/api/3/issue/${ref.issueIdOrKey}/comment`, {
		body: adfFromText(body),
	})
}

export interface TransitionInput {
	transitionId: string
	comment?: string
}

export const transitionIssue = async (
	client: JiraClient,
	ref: IssueRef,
	input: TransitionInput,
): Promise<void> => {
	const payload: Record<string, unknown> = {
		transition: { id: input.transitionId },
	}
	if (input.comment) {
		payload.update = {
			comment: [{ add: { body: adfFromText(input.comment) } }],
		}
	}
	await client.post(`/rest/api/3/issue/${ref.issueIdOrKey}/transitions`, payload)
}

export interface JiraTransition {
	id: string
	name: string
	to: { id: string; name: string; statusCategory: { key: string } }
}

export const listTransitions = async (
	client: JiraClient,
	ref: IssueRef,
): Promise<JiraTransition[]> => {
	const res = await client.get<{ transitions?: JiraTransition[] }>(
		`/rest/api/3/issue/${ref.issueIdOrKey}/transitions`,
	)
	return res.transitions ?? []
}

export const assignIssue = async (
	client: JiraClient,
	ref: IssueRef,
	accountId: string | null,
): Promise<void> => {
	await client.put(`/rest/api/3/issue/${ref.issueIdOrKey}/assignee`, { accountId })
}
