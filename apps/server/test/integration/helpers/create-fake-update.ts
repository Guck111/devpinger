import type { Bot } from "grammy"
import type { Update } from "grammy/types"

/**
 * Grammy refuses to dispatch updates until `bot.init()` has fetched `getMe`.
 * In tests we don't have a real Telegram backend, so we bypass init by
 * setting `bot.botInfo` directly.
 */
export const seedBotInfo = (
	bot: Bot<never> | Bot<object>,
	overrides: Partial<{
		id: number
		username: string
		first_name: string
	}> = {},
): void => {
	;(bot as { botInfo: unknown }).botInfo = {
		id: overrides.id ?? 999,
		is_bot: true,
		first_name: overrides.first_name ?? "DevPinger",
		username: overrides.username ?? "dev_pinger_test_bot",
		can_join_groups: true,
		can_read_all_group_messages: false,
		supports_inline_queries: false,
		can_connect_to_business: false,
		has_main_web_app: false,
	}
}

type FakeUser = {
	id: number
	username?: string
	firstName?: string
	languageCode?: string
}

let updateIdCounter = 1_000_000

const userFor = (u: FakeUser) => ({
	id: u.id,
	is_bot: false as const,
	first_name: u.firstName ?? "Test",
	username: u.username,
	language_code: u.languageCode ?? "en",
})

export const createCallbackUpdate = (opts: {
	from: FakeUser
	data: string
	chatId?: number
	messageId?: number
	messageText?: string
}): Update => {
	const update_id = updateIdCounter++
	const chatId = opts.chatId ?? opts.from.id
	return {
		update_id,
		callback_query: {
			id: `cbq-${update_id}`,
			from: userFor(opts.from),
			chat_instance: `chat-instance-${update_id}`,
			data: opts.data,
			message: {
				message_id: opts.messageId ?? 1,
				date: Math.floor(Date.now() / 1000),
				chat: {
					id: chatId,
					type: "private",
					first_name: opts.from.firstName ?? "Test",
					username: opts.from.username,
				},
				from: {
					id: 999,
					is_bot: true,
					first_name: "DevPinger",
					username: "dev_pinger_test_bot",
				},
				text: opts.messageText ?? "Mock message",
			},
		},
	}
}

export const createTextMessageUpdate = (opts: {
	from: FakeUser
	text: string
	chatId?: number
}): Update => {
	const update_id = updateIdCounter++
	const chatId = opts.chatId ?? opts.from.id
	return {
		update_id,
		message: {
			message_id: update_id,
			date: Math.floor(Date.now() / 1000),
			chat: {
				id: chatId,
				type: "private",
				first_name: opts.from.firstName ?? "Test",
				username: opts.from.username,
			},
			from: userFor(opts.from),
			text: opts.text,
		},
	}
}

export const createCommandUpdate = (opts: {
	from: FakeUser
	command: string
	args?: string
	chatId?: number
}): Update =>
	createTextMessageUpdate({
		from: opts.from,
		text: `/${opts.command}${opts.args ? ` ${opts.args}` : ""}`,
		chatId: opts.chatId,
	})
