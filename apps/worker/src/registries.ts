import type { DestinationAdapter } from "@devpinger/core"
import { createTelegramAdapter, createTelegramClient } from "@devpinger/destinations-telegram"
import { env } from "./config.js"

export const telegramClient = createTelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN })

class DestinationRegistry {
	private readonly adapters = new Map<string, DestinationAdapter>()

	register(adapter: DestinationAdapter): void {
		this.adapters.set(adapter.id, adapter)
	}

	get(id: string): DestinationAdapter | undefined {
		return this.adapters.get(id)
	}

	require(id: string): DestinationAdapter {
		const adapter = this.adapters.get(id)
		if (!adapter) throw new Error(`No destination adapter registered for "${id}"`)
		return adapter
	}
}

export const destinationRegistry = new DestinationRegistry()
destinationRegistry.register(createTelegramAdapter({ botToken: env.TELEGRAM_BOT_TOKEN }))
