import type { Locale, Translator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"
import type { db as Db } from "../db.js"
import { listConnectedProviders } from "../services/connections.js"
import { countEventsLast7d } from "../services/history.js"

type InlineButton = { text: string; callback_data: string } | { text: string; url: string }

export interface OnboardingStep1Input {
	t: Translator
	username: string | null
}

export interface OnboardingStep1Output {
	welcome: string
	step: { text: string; keyboard: { inline_keyboard: InlineButton[][] } }
}

export const renderOnboardingStep1 = (input: OnboardingStep1Input): OnboardingStep1Output => {
	const { t, username } = input
	const welcome = username ? t("onboarding.welcome", { username }) : t("onboarding.welcomeFallback")
	const stepText = `${t("onboarding.step1Title")}\n\n${t("onboarding.step1Body")}`
	// Lazy OAuth: callback buttons here mint the signed start URL only when
	// the user actually taps, so step-1 messages don't ship a live link.
	const kb = new InlineKeyboard()
		.text(t("hubV2.connections.githubConnect"), "hub:conn:connect:github")
		.row()
		.text(t("hubV2.connections.jiraConnect"), "hub:conn:connect:jira")
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

export const renderOnboardingStep2 = (input: OnboardingStep2Input): OnboardingStep2Output => {
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

export const renderOnboardingStep3 = (input: OnboardingStep3Input): OnboardingStep3Output => {
	const { t, target } = input
	return {
		text: `${t("onboarding.step3Title", { target })}\n\n${t("onboarding.step3Body")}`,
	}
}

const pluralizeConnections = (n: number, locale: Locale): string => {
	if (locale === "ru") {
		const lastTwo = n % 100
		const last = n % 10
		if (lastTwo >= 11 && lastTwo <= 14) return "подключений"
		if (last === 1) return "подключение"
		if (last >= 2 && last <= 4) return "подключения"
		return "подключений"
	}
	return n === 1 ? "connection" : "connections"
}

export interface RenderAdaptiveStartInput {
	db: typeof Db
	userId: string
	t: Translator
	username: string | null
	locale: Locale
}

export const renderAdaptiveStart = async (input: RenderAdaptiveStartInput): Promise<string> => {
	const { db, userId, t, username, locale } = input
	const connectionsCount = (await listConnectedProviders(db, userId)).size
	const eventsLast7d = await countEventsLast7d(db, userId)
	return t("startAdaptive", {
		username: username ?? "",
		connectionsCount,
		connectionsWord: pluralizeConnections(connectionsCount, locale),
		eventsLast7d,
	})
}
