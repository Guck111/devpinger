import nock from "nock"
import { afterEach, describe, expect, it } from "vitest"
import { createJiraClient } from "./client.js"
import { buildProjectJql, createWebhook, deleteWebhook, refreshWebhook } from "./webhooks-api.js"

const JIRA_API = "https://api.atlassian.com"
const CLOUD_ID = "test-cloud"

const client = () => createJiraClient({ accessToken: "tok", cloudId: CLOUD_ID })

describe("buildProjectJql", () => {
	it("throws on empty list — caller must remove webhook instead", () => {
		expect(() => buildProjectJql([])).toThrow(/at least one/)
	})

	it("uses `project = KEY` for a single project", () => {
		expect(buildProjectJql(["SCRUM"])).toBe('project = "SCRUM"')
	})

	it("uses `project IN (...)` for multiple projects", () => {
		expect(buildProjectJql(["A", "B", "C"])).toBe('project IN ("A","B","C")')
	})

	it("escapes quote and backslash to keep JQL valid", () => {
		expect(buildProjectJql(['WEIRD"KEY'])).toBe('project = "WEIRD\\"KEY"')
		expect(buildProjectJql(["BACK\\SLASH"])).toBe('project = "BACK\\\\SLASH"')
	})
})

describe("createWebhook", () => {
	afterEach(() => nock.cleanAll())

	it("returns ids from webhookRegistrationResult", async () => {
		nock(JIRA_API)
			.post(`/ex/jira/${CLOUD_ID}/rest/api/3/webhook`)
			.reply(200, { webhookRegistrationResult: [{ createdWebhookId: 1001 }] })
		const ids = await createWebhook(client(), {
			url: "https://app.example.com/webhooks/jira/abc",
			registrations: [{ jqlFilter: 'project = "A"', events: ["jira:issue_created"] }],
		})
		expect(ids).toEqual([1001])
	})

	it("throws when all registrations contain errors", async () => {
		nock(JIRA_API)
			.post(`/ex/jira/${CLOUD_ID}/rest/api/3/webhook`)
			.reply(200, { webhookRegistrationResult: [{ errors: ["bad jql"] }] })
		await expect(
			createWebhook(client(), {
				url: "https://app.example.com/webhooks/jira/abc",
				registrations: [{ jqlFilter: "bad", events: ["jira:issue_created"] }],
			}),
		).rejects.toThrow(/no ids/)
	})
})

describe("deleteWebhook", () => {
	afterEach(() => nock.cleanAll())

	it("no-ops on empty id list", async () => {
		await expect(deleteWebhook(client(), [])).resolves.toBeUndefined()
	})

	it("sends DELETE with webhookIds in body", async () => {
		const scope = nock(JIRA_API, {
			reqheaders: { "content-type": "application/json" },
		})
			.delete(`/ex/jira/${CLOUD_ID}/rest/api/3/webhook`, { webhookIds: [42, 43] })
			.reply(202)
		await deleteWebhook(client(), [42, 43])
		expect(scope.isDone()).toBe(true)
	})

	it("swallows 404 (webhook already gone)", async () => {
		nock(JIRA_API).delete(`/ex/jira/${CLOUD_ID}/rest/api/3/webhook`).reply(404, {})
		await expect(deleteWebhook(client(), [99])).resolves.toBeUndefined()
	})
})

describe("refreshWebhook", () => {
	afterEach(() => nock.cleanAll())

	it("returns refreshedIds for ones not in failedWebhooks", async () => {
		nock(JIRA_API)
			.put(`/ex/jira/${CLOUD_ID}/rest/api/3/webhook/refresh`, { webhookIds: [1, 2] })
			.reply(200, {
				expirationDate: "2026-06-30T00:00:00Z",
				failedWebhooks: [{ id: 2, errors: ["expired"] }],
			})
		const res = await refreshWebhook(client(), [1, 2])
		expect(res.refreshedIds).toEqual([1])
		expect(res.failedIds).toEqual([2])
		expect(res.expirationDate).toBe("2026-06-30T00:00:00Z")
	})
})
