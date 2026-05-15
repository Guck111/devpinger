import type {
	DestinationAdapter,
	DestinationDeliveryInput,
	DestinationDeliveryResult,
	DestinationFormatted,
	Lang,
	NormalizedEvent,
} from "@devpinger/core"
import { type TelegramClient, createTelegramClient } from "./client.js"
import { formatEvent } from "./format.js"

export interface TelegramAdapterConfig {
	botToken: string
	client?: TelegramClient
}

const chatIdFromPreferences = (preferences: Record<string, unknown>): number | string => {
	const candidate = preferences.telegramChatId ?? preferences.chatId
	if (typeof candidate === "number") return candidate
	if (typeof candidate === "string" && candidate.length > 0) return candidate
	throw new Error("Telegram destination requires `telegramChatId` in user preferences")
}

const eventIdFromInput = (event: NormalizedEvent): string => {
	// In V1 the worker passes the persisted event row's id via metadata.eventId
	// when calling deliver(). Falling back to sourceEventId keeps the adapter
	// usable in tests where no DB-side id exists yet.
	const fromMeta = (event.metadata as { eventId?: unknown } | null | undefined)?.eventId
	if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta
	return event.sourceEventId
}

export const createTelegramAdapter = (config: TelegramAdapterConfig): DestinationAdapter => {
	const client = config.client ?? createTelegramClient({ botToken: config.botToken })

	const deliver = async (input: DestinationDeliveryInput): Promise<DestinationDeliveryResult> => {
		const chatId = chatIdFromPreferences(input.user.preferences)
		const formatted = formatEvent({
			event: input.event,
			lang: input.user.lang,
			eventId: eventIdFromInput(input.event),
			actions: input.actions,
		})
		const sent = await client.sendMessage({
			chatId,
			text: formatted.text,
			keyboard: formatted.keyboard,
		})
		return { messageId: String(sent.messageId), targetRef: String(chatId) }
	}

	const formatForLang = (event: NormalizedEvent, lang: Lang): DestinationFormatted => {
		const formatted = formatEvent({ event, lang, eventId: eventIdFromInput(event) })
		return { text: formatted.text, markup: formatted.keyboard }
	}

	const adapter: DestinationAdapter & { client: TelegramClient } = {
		id: "telegram",
		displayName: "Telegram",
		deliver,
		formatEvent: formatForLang,
		client,
	}
	return adapter
}
