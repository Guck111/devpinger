import type { Translator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"
import type { db as Db } from "../../db.js"
import { listConnectedProviders } from "../../services/connections.js"

export interface RenderConnectionsInput {
	db: typeof Db
	userId: string
	t: Translator
}

type InlineButton = { text: string; callback_data: string } | { text: string; url: string }

export interface RenderedConnections {
	text: string
	keyboard: { inline_keyboard: InlineButton[][] }
}

export const renderConnectionsSection = async (
	input: RenderConnectionsInput,
): Promise<RenderedConnections> => {
	const { db, userId, t } = input
	const connected = await listConnectedProviders(db, userId)
	const kb = new InlineKeyboard()

	const gh = connected.get("github")
	if (gh) {
		kb.text(
			t("hubV2.connections.githubConnected", { login: gh.providerUsername ?? "you" }),
			"hub:noop",
		).row()
		kb.text(t("hubV2.connections.openRepos"), "hub:conn:open:repos")
			.text(t("hubV2.connections.disconnect"), "hub:conn:disconnect:github")
			.row()
	} else {
		// Lazy OAuth: the URL is only minted when the user actually taps the
		// button, so the signed link never appears in chat history until then.
		kb.text(t("hubV2.connections.githubConnect"), "hub:conn:connect:github").row()
	}

	const ji = connected.get("jira")
	if (ji) {
		kb.text(
			t("hubV2.connections.jiraConnected", { login: ji.providerUsername ?? "you" }),
			"hub:noop",
		).row()
		kb.text(t("hubV2.connections.openProjects"), "hub:conn:open:projects")
			.text(t("hubV2.connections.disconnect"), "hub:conn:disconnect:jira")
			.row()
	} else {
		kb.text(t("hubV2.connections.jiraConnect"), "hub:conn:connect:jira").row()
	}

	kb.text(t("hubV2.close"), "hub:close")

	return {
		text: t("hubV2.connections.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as InlineButton[][] },
	}
}
