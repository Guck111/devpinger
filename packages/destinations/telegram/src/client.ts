import { Bot, GrammyError, HttpError } from "grammy"
import type { InlineKeyboard } from "grammy"

export interface TelegramClientOptions {
	botToken: string
	maxRetries?: number
	retryBaseMs?: number
}

export interface SendMessageInput {
	chatId: number | string
	text: string
	keyboard?: InlineKeyboard
	parseMode?: "HTML" | "MarkdownV2"
	disableWebPagePreview?: boolean
}

export interface SendMessageResult {
	messageId: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Retries on rate-limit (429) and transient HTTP errors. Non-retryable
// failures (4xx other than 429) bubble immediately so the caller can mark
// the user's chat as unreachable.
const withRetry = async <T>(
	fn: () => Promise<T>,
	maxRetries: number,
	baseMs: number,
): Promise<T> => {
	let attempt = 0
	while (true) {
		try {
			return await fn()
		} catch (err) {
			attempt += 1
			if (err instanceof GrammyError) {
				if (err.error_code === 429 && attempt <= maxRetries) {
					const retryAfter = err.parameters?.retry_after ?? 2 ** attempt
					await sleep(retryAfter * 1000)
					continue
				}
				throw err
			}
			if (err instanceof HttpError && attempt <= maxRetries) {
				await sleep(baseMs * 2 ** (attempt - 1))
				continue
			}
			throw err
		}
	}
}

export const createTelegramClient = (options: TelegramClientOptions) => {
	const bot = new Bot(options.botToken)
	const maxRetries = options.maxRetries ?? 3
	const retryBaseMs = options.retryBaseMs ?? 500

	const sendMessage = async (input: SendMessageInput): Promise<SendMessageResult> => {
		const result = await withRetry(
			() =>
				bot.api.sendMessage(input.chatId, input.text, {
					parse_mode: input.parseMode ?? "HTML",
					link_preview_options: { is_disabled: input.disableWebPagePreview ?? true },
					reply_markup: input.keyboard,
				}),
			maxRetries,
			retryBaseMs,
		)
		return { messageId: result.message_id }
	}

	return { bot, sendMessage }
}

export type TelegramClient = ReturnType<typeof createTelegramClient>
