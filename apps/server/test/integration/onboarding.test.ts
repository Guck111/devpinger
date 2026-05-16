import { describe, expect, it } from "vitest"
import {
	renderOnboardingStep1,
	renderOnboardingStep2,
	renderOnboardingStep3,
} from "../../src/bot/onboarding.js"

describe("onboarding renderers", () => {
	it("step 1 has welcome + 2 OAuth url buttons", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			const map: Record<string, string> = {
				"onboarding.welcome": `Hi ${p?.username}!`,
				"onboarding.step1Title": "Step 1 of 3",
				"onboarding.step1Body": "pick one",
				"hubV2.connections.githubConnect": "🐙 Connect GitHub",
				"hubV2.connections.jiraConnect": "🟦 Connect Jira",
			}
			return map[k] ?? k
		}
		const r = renderOnboardingStep1({
			t,
			username: "octo",
			githubOauthUrl: "https://x/gh",
			jiraOauthUrl: "https://x/ji",
		})
		expect(r.welcome).toContain("Hi octo")
		expect(r.step.text).toContain("Step 1 of 3")
		const buttons = r.step.keyboard.inline_keyboard.flat()
		expect(buttons.some((b) => "url" in b && b.url === "https://x/gh")).toBe(true)
		expect(buttons.some((b) => "url" in b && b.url === "https://x/ji")).toBe(true)
	})

	it("step 2 includes provider name and CTA to repos/projects", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			if (k === "onboarding.step2Title") return `✅ ${p?.provider} connected. Step 2`
			if (k === "hubV2.connections.openRepos") return "📁 Repositories"
			return k
		}
		const r = renderOnboardingStep2({ t, provider: "github" })
		expect(r.text).toContain("github connected")
		expect(
			r.keyboard.inline_keyboard.flat().some((b) => "text" in b && b.text === "📁 Repositories"),
		).toBe(true)
	})

	it("step 3 includes the connected target", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			if (k === "onboarding.step3Title") return `Done! ${p?.target} connected`
			if (k === "onboarding.step3Body") return "wait for first event"
			return k
		}
		const r = renderOnboardingStep3({ t, target: "octocat/example" })
		expect(r.text).toContain("octocat/example")
		expect(r.text).toContain("wait for first event")
	})
})
