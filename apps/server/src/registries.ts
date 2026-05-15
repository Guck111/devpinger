import type { DestinationAdapter, SourceAdapter } from "@devpinger/core"
import { createTelegramAdapter } from "@devpinger/destinations-telegram"
import { createGithubAdapter } from "@devpinger/sources-github"
import { createJiraAdapter } from "@devpinger/sources-jira"
import { env } from "./config.js"

class SourceRegistry {
	private readonly adapters = new Map<string, SourceAdapter>()

	register(adapter: SourceAdapter): void {
		this.adapters.set(adapter.id, adapter)
	}

	get(id: string): SourceAdapter | undefined {
		return this.adapters.get(id)
	}

	require(id: string): SourceAdapter {
		const adapter = this.adapters.get(id)
		if (!adapter) throw new Error(`No source adapter registered for "${id}"`)
		return adapter
	}

	list(): SourceAdapter[] {
		return Array.from(this.adapters.values())
	}
}

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

	list(): DestinationAdapter[] {
		return Array.from(this.adapters.values())
	}
}

export const sourceRegistry = new SourceRegistry()
export const destinationRegistry = new DestinationRegistry()

sourceRegistry.register(
	createGithubAdapter({
		clientId: env.GITHUB_OAUTH_CLIENT_ID,
		clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
	}),
)
sourceRegistry.register(
	createJiraAdapter({
		clientId: env.JIRA_OAUTH_CLIENT_ID,
		clientSecret: env.JIRA_OAUTH_CLIENT_SECRET,
	}),
)
destinationRegistry.register(createTelegramAdapter({ botToken: env.TELEGRAM_BOT_TOKEN }))

export type { SourceRegistry, DestinationRegistry }
