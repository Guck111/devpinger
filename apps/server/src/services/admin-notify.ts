import { bot } from "../bot/index.js"
import { env } from "../config.js"
import { logger } from "../logger.js"

const escapeMd = (s: string): string => s.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1")

export const notifyAdmin = async (markdownV2: string): Promise<void> => {
	const adminId = env.ADMIN_TELEGRAM_ID
	if (!adminId) {
		logger.debug({}, "admin notify skipped: ADMIN_TELEGRAM_ID not set")
		return
	}
	try {
		await bot.api.sendMessage(adminId, markdownV2, {
			parse_mode: "MarkdownV2",
			link_preview_options: { is_disabled: true },
		})
	} catch (err) {
		logger.error({ err }, "admin notify failed")
	}
}

export { escapeMd }
