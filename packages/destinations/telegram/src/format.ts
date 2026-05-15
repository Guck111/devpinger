import type { DestinationAction, Lang, NormalizedEvent } from "@devpinger/core"
import { PRIORITY_ICON, getEventActionLabel, isTerminalEventType } from "@devpinger/core"
import { botMessages, createTranslator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"

const escapeHtml = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export interface FormattedNotification {
	text: string
	keyboard: InlineKeyboard
}

const translatorFor = (lang: Lang) =>
	createTranslator(
		botMessages[lang] as Record<string, unknown> as Parameters<typeof createTranslator>[0],
	)

const buildDefaultKeyboard = (
	event: NormalizedEvent,
	eventId: string,
	t: (key: string) => string,
): InlineKeyboard => {
	const kb = new InlineKeyboard()
	if (event.source === "github" && event.type.startsWith("pull_request.")) {
		const isTerminal = isTerminalEventType(event.type)
		if (!isTerminal) kb.text(t("actions.approve"), `act:approve:${eventId}`)
		kb.text(t("actions.comment"), `act:comment:${eventId}`)
		kb.text(t("actions.viewDiff"), `act:view:${eventId}`)
		kb.row()
		kb.text(t("actions.snooze4h"), `act:snz4h:${eventId}`)
		kb.text(t("actions.snoozeDay"), `act:snz1d:${eventId}`)
		kb.url(t("actions.open"), event.url)
		return kb
	}
	if (event.source === "github" && event.type === "issue_comment") {
		kb.text(t("actions.comment"), `act:comment:${eventId}`)
		kb.text(t("actions.snooze4h"), `act:snz4h:${eventId}`)
		kb.url(t("actions.open"), event.url)
		return kb
	}
	if (event.source === "github" && event.type.startsWith("issues.")) {
		kb.text(t("actions.comment"), `act:comment:${eventId}`)
		kb.text(t("actions.snooze4h"), `act:snz4h:${eventId}`)
		kb.url(t("actions.open"), event.url)
		return kb
	}
	if (event.source === "github" && event.type === "workflow_run.failure") {
		kb.text(t("actions.snooze1h"), `act:snz1h:${eventId}`)
		kb.text(t("actions.mute"), `act:mute:${eventId}`)
		kb.url(t("actions.open"), event.url)
		return kb
	}
	if (event.source === "jira" && event.type.startsWith("jira:issue_")) {
		kb.text(t("actions.comment"), `act:comment:${eventId}`)
		kb.text(t("actions.transition"), `act:trans:${eventId}`)
		kb.row()
		kb.text(t("actions.snooze4h"), `act:snz4h:${eventId}`)
		kb.url(t("actions.open"), event.url)
		return kb
	}
	if (
		event.source === "jira" &&
		(event.type === "comment_created" || event.type === "comment_updated")
	) {
		kb.text(t("actions.reply"), `act:reply:${eventId}`)
		kb.text(t("actions.snooze4h"), `act:snz4h:${eventId}`)
		kb.url(t("actions.open"), event.url)
		return kb
	}
	kb.text(t("actions.snooze4h"), `act:snz4h:${eventId}`)
	kb.url(t("actions.open"), event.url)
	return kb
}

const keyboardFromActions = (
	actions: DestinationAction[],
	url: string,
	t: (key: string) => string,
): InlineKeyboard => {
	const kb = new InlineKeyboard()
	for (const action of actions) kb.text(action.label, action.id)
	if (actions.length > 0) kb.row()
	kb.url(t("actions.open"), url)
	return kb
}

export interface FormatEventInput {
	event: NormalizedEvent
	lang: Lang
	eventId: string
	actions?: DestinationAction[]
}

export const formatEvent = (input: FormatEventInput): FormattedNotification => {
	const t = translatorFor(input.lang)
	const icon = PRIORITY_ICON[input.event.priority]
	const lines: string[] = []
	const actionLabel = getEventActionLabel(input.event.type, input.event.metadata, t)
	if (actionLabel) {
		lines.push(`${icon} ${actionLabel}`)
		lines.push(`<b>${escapeHtml(input.event.title)}</b>`)
	} else {
		lines.push(`${icon} <b>${escapeHtml(input.event.title)}</b>`)
	}
	if (input.event.actor?.username) {
		lines.push(`└─ @${escapeHtml(input.event.actor.username)}`)
	}
	if (input.event.bodyPreview) {
		const preview =
			input.event.bodyPreview.length > 200
				? `${input.event.bodyPreview.slice(0, 199)}…`
				: input.event.bodyPreview
		lines.push(`└─ ${escapeHtml(preview)}`)
	}
	const text = lines.join("\n")
	const keyboard =
		input.actions && input.actions.length > 0
			? keyboardFromActions(input.actions, input.event.url, t)
			: buildDefaultKeyboard(input.event, input.eventId, t)
	return { text, keyboard }
}
