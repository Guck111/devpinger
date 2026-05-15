import type { NormalizedEvent, Priority } from "@devpinger/core"

interface JiraUser {
	accountId?: string
	displayName?: string
	emailAddress?: string
}

interface JiraIssueFields {
	summary?: string
	description?: unknown
	priority?: { name?: string }
	status?: { name?: string; statusCategory?: { key?: string } }
	assignee?: JiraUser | null
	reporter?: JiraUser | null
	project?: { key?: string; name?: string; id?: string }
}

interface JiraIssue {
	id?: string
	key?: string
	self?: string
	fields?: JiraIssueFields
}

interface JiraWorklog {
	id?: string
	author?: JiraUser
	updateAuthor?: JiraUser
	comment?: unknown
	timeSpent?: string
	timeSpentSeconds?: number
	started?: string
}

export interface JiraWebhookEnvelope {
	webhookEvent: string
	issue_event_type_name?: string
	timestamp?: number
	user?: JiraUser
	issue?: JiraIssue
	comment?: { id?: string; body?: unknown; author?: JiraUser; updateAuthor?: JiraUser }
	worklog?: JiraWorklog
}

const PRIORITY_MAP: Record<string, Priority> = {
	Highest: "high",
	High: "high",
	Medium: "medium",
	Low: "low",
	Lowest: "low",
}

const priorityOf = (issue: JiraIssue | undefined, _eventKey: string): Priority => {
	const named = issue?.fields?.priority?.name ?? ""
	if (PRIORITY_MAP[named]) return PRIORITY_MAP[named]
	return "medium"
}

const usernameOf = (user: JiraUser | undefined): string | undefined => {
	const name = user?.displayName
	if (!name) return undefined
	return name.replace(/\s+/g, "_").toLowerCase()
}

const actorOf = (user: JiraUser | undefined) => {
	if (!user?.accountId || !user.displayName) return undefined
	return {
		id: user.accountId,
		username: usernameOf(user) ?? user.accountId,
		displayName: user.displayName,
	}
}

const siteBaseFromSelf = (self: string | undefined): string => {
	if (!self) return "https://atlassian.net"
	try {
		const u = new URL(self)
		return `${u.protocol}//${u.host}`
	} catch {
		return "https://atlassian.net"
	}
}

const repoOf = (issue: JiraIssue | undefined) => {
	const project = issue?.fields?.project
	if (!project?.id || !project.name || !project.key) return undefined
	return {
		id: project.id,
		name: project.name,
		fullName: `jira/${project.key}`,
		url: `${siteBaseFromSelf(issue?.self)}/browse/${project.key}`,
	}
}

const issueUrl = (issue: JiraIssue | undefined): string => {
	if (!issue?.key) return "https://atlassian.net"
	return `${siteBaseFromSelf(issue.self)}/browse/${issue.key}`
}

// Walk an ADF (Atlassian Document Format) tree, accumulating text segments
// and detecting mentions of `viewerAccountId`. Mentions can appear as
// `{type: "mention", attrs: {id}}` nodes or, less commonly, as
// `{type: "inlineCard", attrs: {url}}` whose url contains the account id.
interface AdfWalkResult {
	text: string
	mentionsViewer: boolean
}

const walkAdf = (node: unknown, viewerAccountId: string | null): AdfWalkResult => {
	const parts: string[] = []
	let mentions = false
	const visit = (n: unknown): void => {
		if (!n || typeof n !== "object") return
		const item = n as {
			type?: string
			text?: string
			attrs?: { id?: string; url?: string; accountId?: string }
			content?: unknown[]
		}
		if (typeof item.text === "string") parts.push(item.text)
		if (viewerAccountId && item.type === "mention") {
			const id = item.attrs?.id ?? item.attrs?.accountId
			if (id === viewerAccountId) mentions = true
		}
		if (viewerAccountId && item.type === "inlineCard") {
			const url = item.attrs?.url
			if (typeof url === "string" && url.includes(viewerAccountId)) mentions = true
		}
		if (Array.isArray(item.content)) {
			for (const child of item.content) visit(child)
		}
	}
	visit(node)
	return { text: parts.join(" "), mentionsViewer: mentions }
}

const textPreview = (description: unknown): string | undefined => {
	if (typeof description === "string") return description.slice(0, 200)
	if (description && typeof description === "object" && "content" in description) {
		const { text } = walkAdf(description, null)
		return text.slice(0, 200) || undefined
	}
	return undefined
}

const commentText = (
	body: unknown,
	viewerAccountId: string | null,
): { text: string; mentionsViewer: boolean } => {
	if (typeof body === "string") {
		// Wiki-markup style: comment.body contains [~accountid:abc123] markers
		// for mentions when the ADF is rendered as wiki text.
		const mentions = viewerAccountId ? body.includes(`accountid:${viewerAccountId}`) : false
		return { text: body, mentionsViewer: mentions }
	}
	if (body && typeof body === "object") {
		const { text, mentionsViewer } = walkAdf(body, viewerAccountId)
		return { text, mentionsViewer }
	}
	return { text: "", mentionsViewer: false }
}

export interface NormalizeJiraInput {
	envelope: JiraWebhookEnvelope
	viewerAccountId: string | null
}

// Per-event-type metadata shapes that normalizeJiraEvent writes to
// NormalizedEvent.metadata. Consumers should prefer these typed shapes
// over `Record<string, unknown>` once they know the event.type.
export interface JiraIssueMeta {
	issueKey: string
	projectKey: string | null
	status: string | null
	assigneeId: string | null
}
export interface JiraCommentMeta extends JiraIssueMeta {
	commentId: string | null
	mentionsViewer: boolean
}
export interface JiraWorklogMeta extends JiraIssueMeta {
	worklogId: string | null
	timeSpent: string | null
	timeSpentSeconds: number | null
}

export type JiraEventMetadata = JiraIssueMeta | JiraCommentMeta | JiraWorklogMeta

const baseMetadata = (issue: JiraIssue): Record<string, unknown> => {
	const projectKey = issue.fields?.project?.key
	return {
		issueKey: issue.key,
		projectKey: projectKey ?? null,
		status: issue.fields?.status?.name ?? null,
		assigneeId: issue.fields?.assignee?.accountId ?? null,
	}
}

export const normalizeJiraEvent = (input: NormalizeJiraInput): NormalizedEvent | null => {
	const { envelope, viewerAccountId } = input
	const event = envelope.webhookEvent
	const createdAt = envelope.timestamp ? new Date(envelope.timestamp) : new Date()

	if (event.startsWith("jira:issue_")) {
		const issue = envelope.issue
		if (!issue?.key || !issue.id) return null
		const fields = issue.fields ?? {}
		const isAssignedToViewer =
			event === "jira:issue_updated" &&
			viewerAccountId !== null &&
			fields.assignee?.accountId === viewerAccountId
		return {
			source: "jira",
			sourceEventId: `${event}-${issue.id}-${createdAt.getTime()}`,
			type: event,
			priority: isAssignedToViewer ? "high" : priorityOf(issue, event),
			title: `${issue.key} ${fields.summary ?? "Jira issue"}`,
			bodyPreview: textPreview(fields.description),
			url: issueUrl(issue),
			repo: repoOf(issue),
			actor: actorOf(envelope.user ?? fields.reporter ?? undefined),
			metadata: baseMetadata(issue),
			createdAt,
		}
	}

	if (event === "comment_created" || event === "comment_updated") {
		const issue = envelope.issue
		const comment = envelope.comment
		if (!issue?.key || !comment) return null
		const { text, mentionsViewer } = commentText(comment.body, viewerAccountId)
		return {
			source: "jira",
			sourceEventId: `${event}-${comment.id ?? issue.id ?? "x"}`,
			type: event,
			priority: mentionsViewer ? "high" : "medium",
			title: `Comment on ${issue.key}`,
			bodyPreview: text.slice(0, 200),
			url: `${issueUrl(issue)}?focusedCommentId=${comment.id ?? ""}`,
			repo: repoOf(issue),
			actor: actorOf(comment.author ?? comment.updateAuthor ?? envelope.user),
			metadata: {
				...baseMetadata(issue),
				commentId: comment.id ?? null,
				mentionsViewer,
			},
			createdAt,
		}
	}

	if (event === "worklog_created" || event === "worklog_updated" || event === "worklog_deleted") {
		const issue = envelope.issue
		const worklog = envelope.worklog
		if (!issue?.key || !worklog) return null
		return {
			source: "jira",
			sourceEventId: `${event}-${worklog.id ?? issue.id ?? "x"}`,
			type: event,
			priority: "low",
			title: `Worklog on ${issue.key}`,
			bodyPreview: textPreview(worklog.comment),
			url: issueUrl(issue),
			repo: repoOf(issue),
			actor: actorOf(worklog.author ?? worklog.updateAuthor ?? envelope.user),
			metadata: {
				...baseMetadata(issue),
				worklogId: worklog.id ?? null,
				timeSpent: worklog.timeSpent ?? null,
				timeSpentSeconds: worklog.timeSpentSeconds ?? null,
			},
			createdAt,
		}
	}

	return null
}
