import type { Api, RawApi } from "grammy"

interface BotCommand {
	command: string
	description: string
}

const COMMANDS_EN: BotCommand[] = [
	{ command: "start", description: "Main menu" },
	{ command: "help", description: "What this bot does and how to use it" },
	{ command: "repos", description: "GitHub repositories" },
	{ command: "projects", description: "Jira projects" },
	{ command: "mutes", description: "Manage mute rules" },
	{ command: "recent", description: "Last 20 events" },
	{ command: "stats", description: "Activity summary" },
	{ command: "lang", description: "Switch language" },
	{ command: "cancel", description: "Cancel the current step" },
]

const COMMANDS_RU: BotCommand[] = [
	{ command: "start", description: "Главное меню" },
	{ command: "help", description: "Что делает бот и как им пользоваться" },
	{ command: "repos", description: "Репозитории GitHub" },
	{ command: "projects", description: "Проекты Jira" },
	{ command: "mutes", description: "Управление мьютами" },
	{ command: "recent", description: "Последние 20 событий" },
	{ command: "stats", description: "Сводка активности" },
	{ command: "lang", description: "Сменить язык" },
	{ command: "cancel", description: "Отменить текущий шаг" },
]

export const registerBotCommands = async (api: Api<RawApi>): Promise<void> => {
	await api.setMyCommands(COMMANDS_EN)
	await api.setMyCommands(COMMANDS_RU, { language_code: "ru" })
}
