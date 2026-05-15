import type { NormalizedEvent } from "./events.js"

export type DestinationId = "telegram"

export type Lang = "en" | "ru"

export interface DestinationUser {
	id: string
	lang: Lang
	preferences: Record<string, unknown>
}

export interface DestinationAction {
	id: string
	label: string
}

export interface DestinationDeliveryInput {
	user: DestinationUser
	event: NormalizedEvent
	actions: DestinationAction[]
}

export interface DestinationDeliveryResult {
	messageId?: string
	targetRef?: string
}

export interface DestinationInteractionInput {
	user: { id: string }
	payload: unknown
}

export interface DestinationFormatted {
	text: string
	markup?: unknown
}

export interface DestinationAdapter {
	readonly id: DestinationId
	readonly displayName: string

	deliver(input: DestinationDeliveryInput): Promise<DestinationDeliveryResult>

	handleInteraction?(input: DestinationInteractionInput): Promise<void>

	formatEvent?(event: NormalizedEvent, lang: Lang): DestinationFormatted
}
