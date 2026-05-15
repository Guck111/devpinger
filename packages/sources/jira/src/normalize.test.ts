import { describe, expect, it } from "vitest"
import { type JiraWebhookEnvelope, normalizeJiraEvent } from "./normalize.js"

const baseIssue = {
	id: "10001",
	key: "DEV-1",
	self: "https://acme.atlassian.net/rest/api/3/issue/10001",
	fields: {
		summary: "Fix login bug",
		status: { name: "In Progress" },
		project: { id: "p1", key: "DEV", name: "Devpinger" },
		priority: { name: "High" },
	},
}

const baseUser = {
	accountId: "viewer-abc",
	displayName: "Viewer Person",
}

const envelope = (overrides: Partial<JiraWebhookEnvelope> = {}): JiraWebhookEnvelope => ({
	webhookEvent: "jira:issue_created",
	timestamp: 1700000000000,
	user: baseUser,
	issue: baseIssue,
	...overrides,
})

describe("normalizeJiraEvent", () => {
	it("returns null for unknown event types", () => {
		const result = normalizeJiraEvent({
			envelope: envelope({ webhookEvent: "user_created" }),
			viewerAccountId: "viewer-abc",
		})
		expect(result).toBeNull()
	})

	it("normalizes issue_created with high priority from priority.name=High", () => {
		const result = normalizeJiraEvent({
			envelope: envelope({ webhookEvent: "jira:issue_created" }),
			viewerAccountId: "viewer-abc",
		})
		expect(result?.source).toBe("jira")
		expect(result?.type).toBe("jira:issue_created")
		expect(result?.priority).toBe("high")
		expect(result?.title).toContain("DEV-1")
		expect(result?.repo?.fullName).toBe("jira/DEV")
		expect((result?.metadata as { projectKey?: string }).projectKey).toBe("DEV")
	})

	it("escalates issue_updated to high when assigned to the viewer", () => {
		const result = normalizeJiraEvent({
			envelope: envelope({
				webhookEvent: "jira:issue_updated",
				issue: {
					...baseIssue,
					fields: { ...baseIssue.fields, assignee: { accountId: "viewer-abc" } },
				},
			}),
			viewerAccountId: "viewer-abc",
		})
		expect(result?.priority).toBe("high")
	})

	it("detects ADF mentions in comments", () => {
		const adfBody = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "Take a look " },
						{ type: "mention", attrs: { id: "viewer-abc", text: "@Viewer Person" } },
					],
				},
			],
		}
		const result = normalizeJiraEvent({
			envelope: envelope({
				webhookEvent: "comment_created",
				comment: { id: "c1", body: adfBody, author: baseUser },
			}),
			viewerAccountId: "viewer-abc",
		})
		expect(result?.priority).toBe("high")
		expect((result?.metadata as { mentionsViewer?: boolean }).mentionsViewer).toBe(true)
		expect(result?.bodyPreview).toContain("Take a look")
	})

	it("detects inlineCard mentions whose url contains the account id", () => {
		const adfBody = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "FYI " },
						{
							type: "inlineCard",
							attrs: { url: "https://acme.atlassian.net/people/viewer-abc" },
						},
					],
				},
			],
		}
		const result = normalizeJiraEvent({
			envelope: envelope({
				webhookEvent: "comment_created",
				comment: { id: "c2", body: adfBody, author: baseUser },
			}),
			viewerAccountId: "viewer-abc",
		})
		expect(result?.priority).toBe("high")
		expect((result?.metadata as { mentionsViewer?: boolean }).mentionsViewer).toBe(true)
	})

	it("leaves comment priority at medium without a viewer mention", () => {
		const adfBody = {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: "Plain comment" }] }],
		}
		const result = normalizeJiraEvent({
			envelope: envelope({
				webhookEvent: "comment_updated",
				comment: { id: "c3", body: adfBody, author: baseUser },
			}),
			viewerAccountId: "viewer-abc",
		})
		expect(result?.priority).toBe("medium")
	})

	it("normalizes worklog_created with low priority", () => {
		const result = normalizeJiraEvent({
			envelope: envelope({
				webhookEvent: "worklog_created",
				worklog: { id: "w1", author: baseUser, timeSpent: "1h", timeSpentSeconds: 3600 },
			}),
			viewerAccountId: "viewer-abc",
		})
		expect(result?.type).toBe("worklog_created")
		expect(result?.priority).toBe("low")
		expect((result?.metadata as { timeSpentSeconds?: number }).timeSpentSeconds).toBe(3600)
	})

	it("returns null for worklog event without worklog payload", () => {
		const result = normalizeJiraEvent({
			envelope: envelope({ webhookEvent: "worklog_deleted" }),
			viewerAccountId: "viewer-abc",
		})
		expect(result).toBeNull()
	})
})
