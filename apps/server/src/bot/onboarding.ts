import type { Translator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"

type InlineButton =
	| { text: string; callback_data: string }
	| { text: string; url: string }

export interface OnboardingStep1Input {
	t: Translator
	username: string | null
	githubOauthUrl: string
	jiraOauthUrl: string
}

export interface OnboardingStep1Output {
	welcome: string
	step: { text: string; keyboard: { inline_keyboard: InlineButton[][] } }
}

export const renderOnboardingStep1 = (
	input: OnboardingStep1Input,
): OnboardingStep1Output => {
	const { t, username, githubOauthUrl, jiraOauthUrl } = input
	const welcome = username
		? t("onboarding.welcome", { username })
		: t("onboarding.welcomeFallback")
	const stepText = `${t("onboarding.step1Title")}\n\n${t("onboarding.step1Body")}`
	const kb = new InlineKeyboard()
		.url(t("hubV2.connections.githubConnect"), githubOauthUrl)
		.row()
		.url(t("hubV2.connections.jiraConnect"), jiraOauthUrl)
	return {
		welcome,
		step: {
			text: stepText,
			keyboard: { inline_keyboard: kb.inline_keyboard as unknown as InlineButton[][] },
		},
	}
}

export interface OnboardingStep2Input {
	t: Translator
	provider: "github" | "jira"
}

export interface OnboardingStep2Output {
	text: string
	keyboard: { inline_keyboard: InlineButton[][] }
}

export const renderOnboardingStep2 = (
	input: OnboardingStep2Input,
): OnboardingStep2Output => {
	const { t, provider } = input
	const cta =
		provider === "github"
			? { label: t("hubV2.connections.openRepos"), data: "hub:conn:open:repos" }
			: { label: t("hubV2.connections.openProjects"), data: "hub:conn:open:projects" }
	const kb = new InlineKeyboard().text(cta.label, cta.data)
	return {
		text: t("onboarding.step2Title", { provider }),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as InlineButton[][] },
	}
}

export interface OnboardingStep3Input {
	t: Translator
	target: string
}

export interface OnboardingStep3Output {
	text: string
}

export const renderOnboardingStep3 = (
	input: OnboardingStep3Input,
): OnboardingStep3Output => {
	const { t, target } = input
	return {
		text: `${t("onboarding.step3Title", { target })}\n\n${t("onboarding.step3Body")}`,
	}
}
