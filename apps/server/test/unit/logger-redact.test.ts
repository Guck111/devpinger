import pino from "pino"
import { describe, expect, it } from "vitest"
import { REDACT_PATHS } from "../../src/logger.js"

const buildLogger = (sink: string[]) =>
	pino(
		{
			level: "info",
			redact: {
				paths: [...REDACT_PATHS],
				censor: "[REDACTED]",
			},
		},
		{
			write: (s: string) => {
				sink.push(s)
			},
		},
	)

describe("logger redact config", () => {
	it("censors webhookSecret on nested objects", () => {
		const sink: string[] = []
		buildLogger(sink).warn({ sub: { id: "abc", webhookSecret: "TOPSECRETVALUE" } }, "test")
		const output = sink.join("")
		expect(output).toContain("[REDACTED]")
		expect(output).not.toContain("TOPSECRETVALUE")
	})

	it("censors accessToken and refreshToken on credentials objects", () => {
		const sink: string[] = []
		buildLogger(sink).info(
			{
				conn: {
					id: "c1",
					accessToken: "ghp_LEAK1",
					refreshToken: "ref_LEAK2",
					encryptedCredentials: "blob_LEAK3",
				},
			},
			"test",
		)
		const output = sink.join("")
		expect(output).not.toContain("LEAK1")
		expect(output).not.toContain("LEAK2")
		expect(output).not.toContain("LEAK3")
	})

	it("censors authorization and cookie headers", () => {
		const sink: string[] = []
		buildLogger(sink).info(
			{
				headers: { authorization: "Bearer SECRET_TOKEN", cookie: "session=SECRET_COOKIE" },
			},
			"test",
		)
		const output = sink.join("")
		expect(output).not.toContain("SECRET_TOKEN")
		expect(output).not.toContain("SECRET_COOKIE")
	})

	it("censors req.url so Jira ?secret=... query never leaks", () => {
		const sink: string[] = []
		buildLogger(sink).info(
			{
				req: {
					id: "r1",
					method: "POST",
					url: "/webhooks/jira/conn-abc?secret=JIRA_TENANT_SECRET_XYZ",
				},
			},
			"webhook received",
		)
		const output = sink.join("")
		expect(output).not.toContain("JIRA_TENANT_SECRET_XYZ")
		expect(output).toContain("[REDACTED]")
	})

	it("censors req.query.secret and the x-devping-webhook-secret header", () => {
		const sink: string[] = []
		buildLogger(sink).info(
			{
				req: {
					id: "r2",
					method: "POST",
					query: { secret: "QUERY_SECRET_VALUE" },
					headers: {
						"x-devping-webhook-secret": "HEADER_SECRET_VALUE",
						authorization: "Bearer AUTH_VALUE",
					},
				},
			},
			"webhook received",
		)
		const output = sink.join("")
		expect(output).not.toContain("QUERY_SECRET_VALUE")
		expect(output).not.toContain("HEADER_SECRET_VALUE")
		expect(output).not.toContain("AUTH_VALUE")
	})

	it("censors any *.secret field (defense in depth)", () => {
		const sink: string[] = []
		buildLogger(sink).info(
			{
				jiraWebhook: { id: 123, secret: "INNER_SECRET_VALUE" },
			},
			"test",
		)
		const output = sink.join("")
		expect(output).not.toContain("INNER_SECRET_VALUE")
	})
})
