import type { Api, RawApi } from "grammy"

interface BotCommand {
	command: string
	description: string
}

const COMMANDS_EN: BotCommand[] = [
	{ command: "start", description: "Connect services" },
	{ command: "help", description: "Show available commands" },
	{ command: "sources", description: "Supported sources" },
	{ command: "repos", description: "GitHub repositories to watch" },
	{ command: "projects", description: "Jira projects to watch" },
	{ command: "mutes", description: "Mute rules" },
	{ command: "recent", description: "Last events" },
	{ command: "stats", description: "Activity summary" },
	{ command: "lang", description: "Switch language" },
	{ command: "cancel", description: "Cancel the current step" },
	{ command: "export", description: "Download a JSON copy of your data" },
	{ command: "unsubscribe", description: "Delete your account" },
]

const COMMANDS_RU: BotCommand[] = [
	{ command: "start", description: "Подключить сервисы" },
	{ command: "help", description: "Список команд" },
	{ command: "sources", description: "Поддерживаемые источники" },
	{ command: "repos", description: "Репозитории GitHub" },
	{ command: "projects", description: "Проекты Jira" },
	{ command: "mutes", description: "Правила мьютов" },
	{ command: "recent", description: "Последние события" },
	{ command: "stats", description: "Сводка активности" },
	{ command: "lang", description: "Сменить язык" },
	{ command: "cancel", description: "Отменить текущий шаг" },
	{ command: "export", description: "Скачать копию своих данных" },
	{ command: "unsubscribe", description: "Удалить аккаунт" },
]

export const registerBotCommands = async (api: Api<RawApi>): Promise<void> => {
	await api.setMyCommands(COMMANDS_EN)
	await api.setMyCommands(COMMANDS_RU, { language_code: "ru" })
}
