import pino from "pino"
import { describe, expect, it } from "vitest"

const buildLogger = (sink: string[]) =>
	pino(
		{
			level: "info",
			redact: {
				paths: [
					"*.webhookSecret",
					"*.accessToken",
					"*.refreshToken",
					"*.encryptedCredentials",
					"*.client_secret",
					"*.token",
					"*.password",
					"headers.authorization",
					"headers.cookie",
				],
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
})
