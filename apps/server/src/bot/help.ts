import type { CommandContext } from "grammy"
import type { BotContext } from "./index.js"

export const handleHelpCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	await ctx.reply(ctx.t("helpV2.text"), { parse_mode: "HTML" })
}
