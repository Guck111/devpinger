import { botMessages } from "@devpinger/i18n"
import type { Api, RawApi } from "grammy"

export const registerBotMetadata = async (api: Api<RawApi>): Promise<void> => {
	await api.setMyShortDescription(botMessages.en.metadata.short)
	await api.setMyShortDescription(botMessages.ru.metadata.short, { language_code: "ru" })
	await api.setMyDescription(botMessages.en.metadata.long)
	await api.setMyDescription(botMessages.ru.metadata.long, { language_code: "ru" })
}
