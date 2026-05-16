# Bot UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести Telegram-бота DevPinger с «12 slash-команд без guidance» на полноценный UX: reply-keyboard 2×2 как постоянная навигация, inline-хаб с разделами, onboarding-визард для новых юзеров, adaptive `/start`, BotFather description.

**Architecture:** Сохраняем grammy + i18n middleware. Hub реализуется как набор `bot.hears(...)` (для reply-keyboard) и `bot.callbackQuery(/^hub:.../)` (для inline). Состояние онбординга хранится в БД (`users.onboardingCompletedAt`, `users.firstEventNotifiedAt`). Каждый раздел hub'а живёт в своём файле под `apps/server/src/bot/hub/`.

**Tech Stack:** TypeScript ESM, grammy@1.32, drizzle-orm@0.38, vitest для integration-тестов, pnpm@10 workspace.

**Pre-flight:**
- Работать на ветке `feat/bot-ux-redesign` (отрезать от `main`). Слиять в `main` только после прохождения всего плана и smoke-теста на проде.
- `INTEGRATION_DB_URL` должен быть выставлен для прогона e2e тестов. Если переменной нет, integration-тесты автоматически skip'аются (`describe.skipIf(skip)`).

---

### Task 1: DB migration — add onboarding tracking fields

Добавляем два nullable timestamp-поля в `users`: `onboarding_completed_at` (когда юзер закончил wizard) и `first_event_notified_at` (когда воркер впервые показал follow-up «👋 первое событие!»).

**Files:**
- Modify: `packages/db/src/schema/users.ts`
- Create: `packages/db/drizzle/0005_bot_ux_onboarding.sql` (генерируется автоматически через `drizzle-kit`)

- [ ] **Step 1: Расширить schema**

В [packages/db/src/schema/users.ts](packages/db/src/schema/users.ts), внутри `pgTable("users", { ... })`, после `lastSeenAt` добавить:

```ts
	onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
	firstEventNotifiedAt: timestamp("first_event_notified_at", { withTimezone: true }),
```

- [ ] **Step 2: Сгенерировать миграцию**

Run: `pnpm --filter @devpinger/db generate`

Expected: появляется файл `packages/db/drizzle/0005_*.sql` с `ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;` и аналогичной строкой для `first_event_notified_at`. Содержимое meta тоже обновляется.

- [ ] **Step 3: Прогнать миграцию локально**

Поднять локальный Postgres (testcontainers через `apps/server`'s integration suite или свой), задать `DATABASE_URL`:

Run: `DATABASE_URL=$INTEGRATION_DB_URL pnpm --filter @devpinger/db migrate`

Expected: миграция применяется без ошибок. После — `psql -d devpinger -c "\d users"` показывает новые колонки nullable.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/users.ts packages/db/drizzle/0005_*.sql packages/db/drizzle/meta
git commit -m "db: add users.onboardingCompletedAt + users.firstEventNotifiedAt"
```

---

### Task 2: i18n keys — добавить полный набор новых строк

Hub-меню, onboarding-визард, refactored /help, Telegram description — всё это требует строк в обоих локалях. Делаем разом в обоих JSON-файлах, чтобы избежать «полу-локализованного» состояния.

**Files:**
- Modify: `packages/i18n/src/messages/en/bot.json`
- Modify: `packages/i18n/src/messages/ru/bot.json`

- [ ] **Step 1: Добавить ключи в `ru/bot.json`**

Открыть [packages/i18n/src/messages/ru/bot.json](packages/i18n/src/messages/ru/bot.json). В корне объекта (рядом с существующими `start`, `menu` и т.д.) добавить блок:

```json
"metadata": {
	"short": "Уведомления GitHub/Jira в Telegram с действиями одной кнопкой.",
	"long": "DevPinger собирает уведомления из GitHub и Jira в один Telegram-чат: PR, ревью, комментарии, упавшие workflow, Jira-issues и смену статусов. Действия по одной кнопке — ✅ Approve, 💬 Comment, 🚀 Merge, 🔕 Mute, ⏰ Snooze. Без открытых вкладок и шумных каналов — только то, что важно для тебя."
},
"replyKeyboard": {
	"connections": "📡 Подключения",
	"events": "🔔 События",
	"settings": "⚙️ Настройки",
	"help": "❓ Помощь"
},
"hubV2": {
	"connections": {
		"title": "📡 <b>Подключения</b>\nОткуда приходят события.",
		"githubConnect": "🐙 Подключить GitHub",
		"githubConnected": "✅ GitHub: @{login}",
		"jiraConnect": "🟦 Подключить Jira",
		"jiraConnected": "✅ Jira: {login}",
		"openRepos": "📁 Репозитории",
		"openProjects": "📋 Проекты",
		"disconnect": "🔌 Отключить",
		"disconnectedGithub": "🔌 GitHub отключён. Webhooks в репозиториях остаются — удали их в Settings → Webhooks каждого репо.",
		"disconnectedJira": "🔌 Jira отключена."
	},
	"events": {
		"title": "🔔 <b>События</b>",
		"recent": "📜 Последние 20",
		"stats": "📊 Статистика",
		"mutes": "🔕 Мьюты"
	},
	"settings": {
		"title": "⚙️ <b>Настройки</b>",
		"lang": "🌐 Язык: {current}",
		"notifications": "🔔 Уведомления",
		"account": "👤 Аккаунт"
	},
	"notifications": {
		"title": "🔔 <b>Уведомления</b>",
		"selfActionsOn": "📢 Свои действия: ВКЛ",
		"selfActionsOff": "🔕 Свои действия: ВЫКЛ",
		"selfActionsHint": "Когда ВЫКЛ, бот не присылает события, которые ты сам же и триггерил."
	},
	"account": {
		"title": "👤 <b>Аккаунт</b>",
		"export": "📤 Экспорт данных",
		"delete": "🗑 Удалить аккаунт"
	},
	"back": "← Назад",
	"close": "✖ Закрыть"
},
"onboarding": {
	"welcome": "Привет, {username}! Я <b>DevPinger</b>.\n\nСобираю уведомления из <b>GitHub</b> и <b>Jira</b> в один Telegram-чат и даю действия одной кнопкой: ✅ Approve, 💬 Comment, 🚀 Merge, 🔕 Mute.\n\nБез открытых вкладок и шумных каналов — только то, что важно.",
	"welcomeFallback": "Привет! Я <b>DevPinger</b>.\n\nСобираю уведомления из <b>GitHub</b> и <b>Jira</b> в один Telegram-чат и даю действия одной кнопкой.",
	"step1Title": "<b>Шаг 1 из 3 — подключи провайдер</b>",
	"step1Body": "Достаточно одного, можно оба позже.",
	"step2Title": "✅ {provider} подключён.\n\n<b>Шаг 2 из 3 — выбери, за чем следить</b>",
	"step3Title": "🎉 Готово! {target} подключено.\n\n<b>Шаг 3 из 3 — жди первое событие</b>",
	"step3Body": "Управление — кнопки внизу. Если что — <b>❓ Помощь</b>.",
	"firstEvent": "👋 Первое событие! Кнопки выше — это действия, которые сразу делают что нужно."
},
"helpV2": {
	"text": "🤖 <b>Что я делаю</b>\nСобираю события из GitHub и Jira и шлю их сюда — с кнопками действий.\n\n📡 <b>Поддерживаемое</b>\n<b>GitHub:</b> PR, issue, ревью, комментарии, релизы, упавшие workflow.\n<b>Jira:</b> issues, переходы статусов, комментарии, упоминания.\n\n🚀 <b>Как пользоваться</b>\n1. /start — подключи провайдер.\n2. /repos или /projects — выбери, за чем следить.\n3. Жди первое событие — там будут кнопки действий.\n\n🔕 <b>Лишний шум</b>\n/mutes — отключи целый источник, репо, проект или тип события.\n\n⚙️ <b>Управление</b>\nКнопки внизу: 📡 Подключения · 🔔 События · ⚙️ Настройки · ❓ Помощь"
},
"backToHub": "Открой главное меню кнопкой ниже.",
"startAdaptive": "С возвращением, {username}!\n\n📡 {connectionsCount} {connectionsWord} · 📊 {eventsLast7d} событий за 7 дней\n\nВыбирай раздел внизу или жми /help.",
"mutesAdded": "🔕 Мьют добавлен. Управление — Настройки → 🔕 Мьюты.",
```

Также **удалить** или **оставить** старый блок `hub` (с `connections`, `settings`, `notifications` под старыми именами) — мы выкатываем новый под именем `hubV2`, чтобы не конфликтовать со существующими ключами. После Task'а 9 старые ключи `hub.*` станут не использоваться — удалим в Task 12 на финальной чистке.

- [ ] **Step 2: Добавить ключи в `en/bot.json`**

В [packages/i18n/src/messages/en/bot.json](packages/i18n/src/messages/en/bot.json) добавить тот же набор, в английском переводе:

```json
"metadata": {
	"short": "GitHub/Jira notifications in Telegram with one-tap actions.",
	"long": "DevPinger aggregates notifications from GitHub and Jira into a single Telegram chat: PRs, reviews, comments, failed workflows, Jira issues and status changes. One-tap actions — ✅ Approve, 💬 Comment, 🚀 Merge, 🔕 Mute, ⏰ Snooze. No open tabs, no noisy channels — only what matters to you."
},
"replyKeyboard": {
	"connections": "📡 Connections",
	"events": "🔔 Events",
	"settings": "⚙️ Settings",
	"help": "❓ Help"
},
"hubV2": {
	"connections": {
		"title": "📡 <b>Connections</b>\nWhere events come from.",
		"githubConnect": "🐙 Connect GitHub",
		"githubConnected": "✅ GitHub: @{login}",
		"jiraConnect": "🟦 Connect Jira",
		"jiraConnected": "✅ Jira: {login}",
		"openRepos": "📁 Repositories",
		"openProjects": "📋 Projects",
		"disconnect": "🔌 Disconnect",
		"disconnectedGithub": "🔌 GitHub disconnected. Webhooks on your repos stay — remove them in Settings → Webhooks on each repo.",
		"disconnectedJira": "🔌 Jira disconnected."
	},
	"events": {
		"title": "🔔 <b>Events</b>",
		"recent": "📜 Last 20",
		"stats": "📊 Stats",
		"mutes": "🔕 Mutes"
	},
	"settings": {
		"title": "⚙️ <b>Settings</b>",
		"lang": "🌐 Language: {current}",
		"notifications": "🔔 Notifications",
		"account": "👤 Account"
	},
	"notifications": {
		"title": "🔔 <b>Notifications</b>",
		"selfActionsOn": "📢 Own actions: ON",
		"selfActionsOff": "🔕 Own actions: OFF",
		"selfActionsHint": "When OFF, the bot won't notify you about events you triggered yourself."
	},
	"account": {
		"title": "👤 <b>Account</b>",
		"export": "📤 Export data",
		"delete": "🗑 Delete account"
	},
	"back": "← Back",
	"close": "✖ Close"
},
"onboarding": {
	"welcome": "Hi, {username}! I'm <b>DevPinger</b>.\n\nI aggregate notifications from <b>GitHub</b> and <b>Jira</b> into a single Telegram chat and give you one-tap actions: ✅ Approve, 💬 Comment, 🚀 Merge, 🔕 Mute.\n\nNo open tabs, no noisy channels — only what matters.",
	"welcomeFallback": "Hi! I'm <b>DevPinger</b>.\n\nI aggregate notifications from <b>GitHub</b> and <b>Jira</b> into a single Telegram chat with one-tap actions.",
	"step1Title": "<b>Step 1 of 3 — connect a provider</b>",
	"step1Body": "One is enough, you can add the other later.",
	"step2Title": "✅ {provider} connected.\n\n<b>Step 2 of 3 — pick what to watch</b>",
	"step3Title": "🎉 Done! {target} is connected.\n\n<b>Step 3 of 3 — wait for the first event</b>",
	"step3Body": "Controls live in the buttons below. Need help? Tap <b>❓ Help</b>.",
	"firstEvent": "👋 Your first event! The buttons above are actions — one tap does the thing."
},
"helpV2": {
	"text": "🤖 <b>What I do</b>\nI collect events from GitHub and Jira and send them here — with action buttons.\n\n📡 <b>Supported</b>\n<b>GitHub:</b> PRs, issues, reviews, comments, releases, failed workflows.\n<b>Jira:</b> issues, status transitions, comments, mentions.\n\n🚀 <b>How to use</b>\n1. /start — connect a provider.\n2. /repos or /projects — pick what to watch.\n3. Wait for the first event — action buttons will be inline.\n\n🔕 <b>Mute noise</b>\n/mutes — silence a whole source, repo, project, or event type.\n\n⚙️ <b>Controls</b>\nButtons below: 📡 Connections · 🔔 Events · ⚙️ Settings · ❓ Help"
},
"backToHub": "Open the main menu with the button below.",
"startAdaptive": "Welcome back, {username}!\n\n📡 {connectionsCount} {connectionsWord} · 📊 {eventsLast7d} events in the last 7 days\n\nPick a section below or hit /help.",
"mutesAdded": "🔕 Mute added. Manage — Settings → 🔕 Mutes.",
```

- [ ] **Step 3: Прогнать i18n unit-тесты (sanity-check на валидный JSON и тип BotMessages)**

Run: `pnpm --filter @devpinger/i18n test`

Expected: PASS, `translate.test.ts` всё ещё зелёный. Если упадёт с TypeError на сравнении типов — значит структура EN и RU разошлась; выровнять.

- [ ] **Step 4: TypeScript-проверка по всему workspace**

Run: `pnpm -r typecheck`

Expected: PASS. `BotMessages = typeof enBot` инфёрит структуру от EN, и `ru as BotMessages` должен совпасть — если расхождение, добавь недостающие ключи в RU.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/messages/en/bot.json packages/i18n/src/messages/ru/bot.json
git commit -m "i18n(bot): add metadata/hubV2/onboarding/helpV2 strings"
```

---

### Task 3: Bot metadata — setMyDescription / setMyShortDescription

Регистрируем длинное и короткое описание бота в BotFather через grammy API при старте, аналогично `setMyCommands`.

**Files:**
- Create: `apps/server/src/bot/metadata.ts`
- Modify: `apps/server/src/bot/index.ts:144-146` (рядом с регистрацией команд)
- Modify: `apps/server/src/index.ts:24` (вызов рядом с `registerBotCommands`)
- Create: `apps/server/test/unit/bot-metadata.test.ts`

- [ ] **Step 1: Написать failing-тест**

Создать [apps/server/test/unit/bot-metadata.test.ts](apps/server/test/unit/bot-metadata.test.ts):

```ts
import { describe, expect, it, vi } from "vitest"
import { registerBotMetadata } from "../../src/bot/metadata.js"

describe("registerBotMetadata", () => {
	it("sets short and long description for en and ru", async () => {
		const setMyDescription = vi.fn().mockResolvedValue(true)
		const setMyShortDescription = vi.fn().mockResolvedValue(true)
		const api = { setMyDescription, setMyShortDescription } as unknown as Parameters<
			typeof registerBotMetadata
		>[0]

		await registerBotMetadata(api)

		expect(setMyShortDescription).toHaveBeenCalledTimes(2)
		expect(setMyShortDescription).toHaveBeenCalledWith({
			short_description: expect.stringMatching(/one-tap/i),
		})
		expect(setMyShortDescription).toHaveBeenCalledWith({
			short_description: expect.stringMatching(/одной кнопкой/i),
			language_code: "ru",
		})
		expect(setMyDescription).toHaveBeenCalledTimes(2)
		expect(setMyDescription).toHaveBeenCalledWith({
			description: expect.stringMatching(/DevPinger/),
		})
		expect(setMyDescription).toHaveBeenCalledWith({
			description: expect.stringMatching(/DevPinger/),
			language_code: "ru",
		})
	})
})
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `pnpm --filter @devpinger/server test test/unit/bot-metadata.test.ts`

Expected: FAIL with `Cannot find module '../../src/bot/metadata.js'`.

- [ ] **Step 3: Создать модуль**

Создать [apps/server/src/bot/metadata.ts](apps/server/src/bot/metadata.ts):

```ts
import { botMessages } from "@devpinger/i18n"
import type { Api, RawApi } from "grammy"

export const registerBotMetadata = async (api: Api<RawApi>): Promise<void> => {
	await api.setMyShortDescription({ short_description: botMessages.en.metadata.short })
	await api.setMyShortDescription({
		short_description: botMessages.ru.metadata.short,
		language_code: "ru",
	})
	await api.setMyDescription({ description: botMessages.en.metadata.long })
	await api.setMyDescription({
		description: botMessages.ru.metadata.long,
		language_code: "ru",
	})
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `pnpm --filter @devpinger/server test test/unit/bot-metadata.test.ts`

Expected: PASS.

- [ ] **Step 5: Подключить вызов на старте**

В [apps/server/src/index.ts](apps/server/src/index.ts), рядом с `registerBotCommands(bot.api)`, добавить:

```ts
import { registerBotMetadata } from "./bot/metadata.js"
```

И внутри `main()` после блока `await registerBotCommands(bot.api)`:

```ts
try {
	await registerBotMetadata(bot.api)
} catch (err) {
	logger.warn({ err }, "failed to publish bot description")
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/bot/metadata.ts apps/server/src/index.ts apps/server/test/unit/bot-metadata.test.ts
git commit -m "bot: register short/long description in BotFather"
```

---

### Task 4: Shrink commands menu

Сокращаем видимый список slash-команд в Telegram menu с 12 до 9. Скрываем `/export`, `/unsubscribe`, `/forget_event`, `/sources`, `/notify_self`, `/status` — они продолжают работать через прямой ввод, но не висят в подсказке.

**Files:**
- Modify: `apps/server/src/bot/commands-menu.ts`
- Create: `apps/server/test/unit/commands-menu.test.ts`

- [ ] **Step 1: Написать failing-тест**

Создать [apps/server/test/unit/commands-menu.test.ts](apps/server/test/unit/commands-menu.test.ts):

```ts
import { describe, expect, it, vi } from "vitest"
import { registerBotCommands } from "../../src/bot/commands-menu.js"

describe("registerBotCommands", () => {
	it("publishes 9 commands and omits the hidden ones", async () => {
		const setMyCommands = vi.fn().mockResolvedValue(true)
		const api = { setMyCommands } as unknown as Parameters<typeof registerBotCommands>[0]

		await registerBotCommands(api)

		expect(setMyCommands).toHaveBeenCalledTimes(2)
		const [enCall, ruCall] = setMyCommands.mock.calls
		const [enCommands] = enCall
		const [ruCommands, ruOpts] = ruCall

		expect(enCommands).toHaveLength(9)
		expect(ruCommands).toHaveLength(9)
		expect(ruOpts).toEqual({ language_code: "ru" })

		const cmds = (enCommands as { command: string }[]).map((c) => c.command)
		expect(cmds).toEqual([
			"start",
			"help",
			"repos",
			"projects",
			"mutes",
			"recent",
			"stats",
			"lang",
			"cancel",
		])
		for (const hidden of ["sources", "export", "unsubscribe", "forget_event", "notify_self", "status"]) {
			expect(cmds).not.toContain(hidden)
		}
	})
})
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `pnpm --filter @devpinger/server test test/unit/commands-menu.test.ts`

Expected: FAIL, потому что текущий `COMMANDS_EN` содержит 12 записей включая `sources`, `export`, `unsubscribe`.

- [ ] **Step 3: Переписать commands-menu**

Заменить содержимое [apps/server/src/bot/commands-menu.ts](apps/server/src/bot/commands-menu.ts):

```ts
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
```

- [ ] **Step 4: Запустить тест — PASS**

Run: `pnpm --filter @devpinger/server test test/unit/commands-menu.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/bot/commands-menu.ts apps/server/test/unit/commands-menu.test.ts
git commit -m "bot: shrink visible commands menu to 9 essentials"
```

---

### Task 5: Refactor `/help` — отдельный файл, длинный текст

`/help` сейчас рендерит плоский список. Выносим его в `bot/help.ts` и подключаем готовый i18n-ключ `helpV2.text` (добавлен в Task 2).

**Files:**
- Create: `apps/server/src/bot/help.ts`
- Modify: `apps/server/src/bot/index.ts:144-146`
- Create: `apps/server/test/integration/help-command.test.ts`

- [ ] **Step 1: Failing-тест**

Создать [apps/server/test/integration/help-command.test.ts](apps/server/test/integration/help-command.test.ts):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { handleHelpCommand } from "../../src/bot/help.js"

describe("handleHelpCommand", () => {
	it("renders helpV2 text in HTML mode", async () => {
		const replies: { text: string; opts?: Record<string, unknown> }[] = []
		const ctx = {
			locale: "en" as const,
			t: (key: string) => (key === "helpV2.text" ? "🤖 <b>What I do</b>\n..." : key),
			reply: async (text: string, opts?: Record<string, unknown>) => {
				replies.push({ text, opts })
			},
		} as unknown as Parameters<typeof handleHelpCommand>[0]

		await handleHelpCommand(ctx)

		expect(replies).toHaveLength(1)
		expect(replies[0]!.text).toContain("What I do")
		expect(replies[0]!.opts).toMatchObject({ parse_mode: "HTML" })
	})
})
```

- [ ] **Step 2: Запустить — FAIL (нет модуля)**

Run: `pnpm --filter @devpinger/server test test/integration/help-command.test.ts`

Expected: FAIL.

- [ ] **Step 3: Реализовать**

Создать [apps/server/src/bot/help.ts](apps/server/src/bot/help.ts):

```ts
import type { CommandContext } from "grammy"
import type { BotContext } from "./index.js"

export const handleHelpCommand = async (ctx: CommandContext<BotContext>): Promise<void> => {
	await ctx.reply(ctx.t("helpV2.text"), { parse_mode: "HTML" })
}
```

В [apps/server/src/bot/index.ts](apps/server/src/bot/index.ts) **заменить** хендлер на строках 144-146:

```ts
bot.command("help", handleHelpCommand)
```

И добавить импорт:

```ts
import { handleHelpCommand } from "./help.js"
```

Удалить старый inline-хендлер `/help` (`bot.command("help", async (ctx) => { await ctx.reply(ctx.t("help.text")) })`) и callback `bot.callbackQuery("help", ...)` — последний пока оставить и тоже вызывать `handleHelpCommand` через `bot.callbackQuery("help", async (ctx) => { await ctx.answerCallbackQuery(); await handleHelpCommand(ctx as unknown as CommandContext<BotContext>) })`. Альтернативно: создать общий рендер и вызывать из обоих мест.

- [ ] **Step 4: Запустить — PASS**

Run: `pnpm --filter @devpinger/server test test/integration/help-command.test.ts`

Expected: PASS.

- [ ] **Step 5: Запустить весь сервер-test набор, чтобы убедиться что typecheck и старые тесты не сломались**

Run: `pnpm --filter @devpinger/server typecheck && pnpm --filter @devpinger/server test`

Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/bot/help.ts apps/server/src/bot/index.ts apps/server/test/integration/help-command.test.ts
git commit -m "bot: dedicated /help with rich helpV2 text"
```

---

### Task 6: Reply-keyboard helper + main hub dispatcher

Утилита `mainReplyKeyboard(ctx)`, возвращающая `Keyboard` 2×2 c i18n-локализованными подписями. Главный диспетчер: `bot.hears(<text>)` для каждой из 4 кнопок открывает соответствующий раздел hub'а (заглушки на этом этапе — реализация в Task 7-9).

**Files:**
- Create: `apps/server/src/bot/hub/keyboard.ts`
- Create: `apps/server/src/bot/hub/index.ts`
- Modify: `apps/server/src/bot/index.ts` (импорт hub-register)
- Create: `apps/server/test/integration/hub-keyboard.test.ts`

- [ ] **Step 1: Failing-тест**

Создать [apps/server/test/integration/hub-keyboard.test.ts](apps/server/test/integration/hub-keyboard.test.ts):

```ts
import { describe, expect, it } from "vitest"
import { mainReplyKeyboard, isMainKeyboardText } from "../../src/bot/hub/keyboard.js"

describe("mainReplyKeyboard", () => {
	it("returns 2x2 layout localized to ru", () => {
		const kb = mainReplyKeyboard((k) => {
			const ru: Record<string, string> = {
				"replyKeyboard.connections": "📡 Подключения",
				"replyKeyboard.events": "🔔 События",
				"replyKeyboard.settings": "⚙️ Настройки",
				"replyKeyboard.help": "❓ Помощь",
			}
			return ru[k] ?? k
		})
		const json = kb.build()
		expect(json[0]).toEqual([{ text: "📡 Подключения" }, { text: "🔔 События" }])
		expect(json[1]).toEqual([{ text: "⚙️ Настройки" }, { text: "❓ Помощь" }])
	})

	it("isMainKeyboardText matches localized labels in en and ru", () => {
		expect(isMainKeyboardText("📡 Подключения")).toBe("connections")
		expect(isMainKeyboardText("📡 Connections")).toBe("connections")
		expect(isMainKeyboardText("🔔 События")).toBe("events")
		expect(isMainKeyboardText("⚙️ Settings")).toBe("settings")
		expect(isMainKeyboardText("❓ Help")).toBe("help")
		expect(isMainKeyboardText("nothing")).toBeNull()
	})
})
```

- [ ] **Step 2: FAIL**

Run: `pnpm --filter @devpinger/server test test/integration/hub-keyboard.test.ts`

Expected: FAIL.

- [ ] **Step 3: Реализовать keyboard**

Создать [apps/server/src/bot/hub/keyboard.ts](apps/server/src/bot/hub/keyboard.ts):

```ts
import { botMessages } from "@devpinger/i18n"
import { Keyboard } from "grammy"
import type { Translator } from "@devpinger/i18n"

export type HubSection = "connections" | "events" | "settings" | "help"

export const mainReplyKeyboard = (t: Translator): Keyboard => {
	return new Keyboard()
		.text(t("replyKeyboard.connections"))
		.text(t("replyKeyboard.events"))
		.row()
		.text(t("replyKeyboard.settings"))
		.text(t("replyKeyboard.help"))
		.resized()
		.persistent()
}

const SECTION_KEYS: HubSection[] = ["connections", "events", "settings", "help"]

let labelToSection: Map<string, HubSection> | null = null
const ensureMap = (): Map<string, HubSection> => {
	if (labelToSection) return labelToSection
	const map = new Map<string, HubSection>()
	for (const locale of ["en", "ru"] as const) {
		const rk = botMessages[locale].replyKeyboard
		for (const section of SECTION_KEYS) {
			map.set(rk[section], section)
		}
	}
	labelToSection = map
	return map
}

export const isMainKeyboardText = (text: string): HubSection | null => {
	return ensureMap().get(text) ?? null
}
```

- [ ] **Step 4: Реализовать hub dispatcher (заглушки на этом этапе)**

Создать [apps/server/src/bot/hub/index.ts](apps/server/src/bot/hub/index.ts):

```ts
import type { Bot } from "grammy"
import type { BotContext } from "../index.js"
import { isMainKeyboardText } from "./keyboard.js"

export const registerHub = (bot: Bot<BotContext>): void => {
	bot.on("message:text", async (ctx, next) => {
		const text = ctx.message?.text
		if (!text) {
			await next()
			return
		}
		const section = isMainKeyboardText(text)
		if (!section) {
			await next()
			return
		}
		switch (section) {
			case "connections":
				await ctx.reply(ctx.t("hubV2.connections.title"), { parse_mode: "HTML" })
				break
			case "events":
				await ctx.reply(ctx.t("hubV2.events.title"), { parse_mode: "HTML" })
				break
			case "settings":
				await ctx.reply(ctx.t("hubV2.settings.title"), { parse_mode: "HTML" })
				break
			case "help":
				await ctx.reply(ctx.t("helpV2.text"), { parse_mode: "HTML" })
				break
		}
	})
}
```

- [ ] **Step 5: Подключить в index.ts**

В [apps/server/src/bot/index.ts](apps/server/src/bot/index.ts) импортировать и зарегистрировать **до** существующего `bot.on("message:text", ...)` (чтобы reply-keyboard перехватывался первым):

```ts
import { registerHub } from "./hub/index.js"
// ...
registerHub(bot)
```

Поместить вызов сразу после `bot.use(...)` блоков и до `bot.command("start", ...)`.

- [ ] **Step 6: PASS**

Run: `pnpm --filter @devpinger/server test test/integration/hub-keyboard.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/bot/hub apps/server/src/bot/index.ts apps/server/test/integration/hub-keyboard.test.ts
git commit -m "bot(hub): main reply-keyboard 2x2 + dispatcher stubs"
```

---

### Task 7: Hub section — Подключения

Раздел показывает inline-карточку: GitHub и Jira с состоянием (подключён / нет), кнопки «Открыть репо / проекты», «Отключить».

**Files:**
- Create: `apps/server/src/bot/hub/connections.ts`
- Modify: `apps/server/src/bot/hub/index.ts` (заменить заглушку для `connections`)
- Modify: `apps/server/src/services/connections.ts` (добавить `deleteConnection`)
- Create: `apps/server/test/integration/hub-connections.test.ts`

- [ ] **Step 1: Расширить `connections` service**

В [apps/server/src/services/connections.ts](apps/server/src/services/connections.ts) после `listConnectedProviders` добавить:

```ts
export const deleteConnection = async (
	db: typeof Db,
	userId: string,
	provider: OauthProvider,
): Promise<{ removed: boolean }> => {
	const result = await db
		.delete(connections)
		.where(and(eq(connections.userId, userId), eq(connections.provider, provider)))
		.returning({ id: connections.id })
	return { removed: result.length > 0 }
}
```

(импорт `and` если ещё не импортирован; в текущем файле уже есть `and, eq, sql`.)

- [ ] **Step 2: Failing-тест на рендеринг секции**

Создать [apps/server/test/integration/hub-connections.test.ts](apps/server/test/integration/hub-connections.test.ts):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDatabase } from "@devpinger/db"
import { renderConnectionsSection } from "../../src/bot/hub/connections.js"
import { addGitHubConnection, createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("hub: connections section", () => {
	let db: ReturnType<typeof createDatabase>

	beforeAll(() => {
		db = createDatabase(integrationDbUrl as string)
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("shows github as connected with login when connection exists", async () => {
		const user = await createTestUser(db)
		await addGitHubConnection(db, user.id, { username: "octocat" })
		const t = (k: string, p?: Record<string, string | number>) => {
			const map: Record<string, string> = {
				"hubV2.connections.title": "📡 Connections",
				"hubV2.connections.githubConnected": `✅ GitHub: @${p?.login ?? ""}`,
				"hubV2.connections.openRepos": "📁 Repositories",
				"hubV2.connections.disconnect": "🔌 Disconnect",
				"hubV2.connections.jiraConnect": "🟦 Connect Jira",
			}
			return map[k] ?? k
		}
		const rendered = await renderConnectionsSection({
			db,
			userId: user.id,
			t,
			oauthUrl: (p) => `https://example.com/oauth/${p}/start`,
		})
		expect(rendered.text).toContain("📡 Connections")
		expect(rendered.keyboard.inline_keyboard.flat().some((b) => "text" in b && b.text === "✅ GitHub: @octocat")).toBe(true)
		expect(rendered.keyboard.inline_keyboard.flat().some((b) => "text" in b && b.text === "📁 Repositories")).toBe(true)
		expect(rendered.keyboard.inline_keyboard.flat().some((b) => "text" in b && b.text === "🔌 Disconnect")).toBe(true)
		expect(rendered.keyboard.inline_keyboard.flat().some((b) => "url" in b)).toBe(true) // jira connect = url button
	})
})
```

- [ ] **Step 3: FAIL**

Run: `INTEGRATION_DB_URL=$INTEGRATION_DB_URL pnpm --filter @devpinger/server test test/integration/hub-connections.test.ts`

Expected: FAIL (module not found).

- [ ] **Step 4: Реализовать секцию**

Создать [apps/server/src/bot/hub/connections.ts](apps/server/src/bot/hub/connections.ts):

```ts
import type { Translator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"
import { listConnectedProviders } from "../../services/connections.js"
import type { db as Db } from "../../db.js"

export interface RenderConnectionsInput {
	db: typeof Db
	userId: string
	t: Translator
	oauthUrl: (provider: "github" | "jira") => string
}

export interface RenderedSection {
	text: string
	keyboard: ReturnType<InlineKeyboard["toJSON"]> extends infer R
		? R extends { inline_keyboard: infer K }
			? { inline_keyboard: K }
			: never
		: never
}

export const renderConnectionsSection = async (
	input: RenderConnectionsInput,
): Promise<{ text: string; keyboard: { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] } }> => {
	const { db, userId, t, oauthUrl } = input
	const connected = await listConnectedProviders(db, userId)
	const kb = new InlineKeyboard()

	const gh = connected.get("github")
	if (gh) {
		kb.text(t("hubV2.connections.githubConnected", { login: gh.providerUsername ?? "you" }), "hub:noop").row()
		kb.text(t("hubV2.connections.openRepos"), "hub:conn:open:repos")
			.text(t("hubV2.connections.disconnect"), "hub:conn:disconnect:github")
			.row()
	} else {
		kb.url(t("hubV2.connections.githubConnect"), oauthUrl("github")).row()
	}

	const ji = connected.get("jira")
	if (ji) {
		kb.text(t("hubV2.connections.jiraConnected", { login: ji.providerUsername ?? "you" }), "hub:noop").row()
		kb.text(t("hubV2.connections.openProjects"), "hub:conn:open:projects")
			.text(t("hubV2.connections.disconnect"), "hub:conn:disconnect:jira")
			.row()
	} else {
		kb.url(t("hubV2.connections.jiraConnect"), oauthUrl("jira")).row()
	}

	kb.text(t("hubV2.close"), "hub:close")

	return {
		text: t("hubV2.connections.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as { text: string; callback_data?: string; url?: string }[][] },
	}
}
```

- [ ] **Step 5: Подключить в dispatcher**

В [apps/server/src/bot/hub/index.ts](apps/server/src/bot/hub/index.ts) **заменить** заглушку для `connections`:

```ts
case "connections": {
	const tgId = ctx.from?.id
	if (!tgId) return
	const user = await getUserByTelegramId(db, tgId)
	if (!user) return
	const sig = (provider: "github" | "jira") =>
		signTg(tgId, `oauth-${provider}-start`, env.ENCRYPTION_KEY)
	const oauthUrl = (provider: "github" | "jira") =>
		`${env.PUBLIC_BASE_URL}/oauth/${provider}/start?sig=${sig(provider)}`
	const rendered = await renderConnectionsSection({ db, userId: user.id, t: ctx.t, oauthUrl })
	await ctx.reply(rendered.text, {
		parse_mode: "HTML",
		reply_markup: rendered.keyboard,
	})
	break
}
```

(импорты: `db`, `getUserByTelegramId`, `env`, `signTg`, `renderConnectionsSection`)

Добавить callback-handler-ы в этом же файле (или вынести):

```ts
bot.callbackQuery(/^hub:conn:open:(repos|projects)$/, async (ctx) => {
	await ctx.answerCallbackQuery()
	const target = ctx.match?.[1]
	if (target === "repos") {
		const { handleReposCommand } = await import("../repos.js")
		await handleReposCommand(ctx as unknown as Parameters<typeof handleReposCommand>[0])
	} else if (target === "projects") {
		const { handleProjectsCommand } = await import("../projects.js")
		await handleProjectsCommand(ctx as unknown as Parameters<typeof handleProjectsCommand>[0])
	}
})

bot.callbackQuery(/^hub:conn:disconnect:(github|jira)$/, async (ctx) => {
	await ctx.answerCallbackQuery()
	const provider = ctx.match?.[1] as "github" | "jira"
	const tgId = ctx.from?.id
	if (!tgId) return
	const user = await getUserByTelegramId(db, tgId)
	if (!user) return
	const { deleteConnection } = await import("../../services/connections.js")
	const { removed } = await deleteConnection(db, user.id, provider)
	if (!removed) return
	const msgKey = provider === "github"
		? "hubV2.connections.disconnectedGithub"
		: "hubV2.connections.disconnectedJira"
	await ctx.reply(ctx.t(msgKey))
})

bot.callbackQuery("hub:close", async (ctx) => {
	await ctx.answerCallbackQuery()
	try {
		await ctx.deleteMessage()
	} catch {
		// best-effort
	}
})

bot.callbackQuery("hub:noop", async (ctx) => {
	await ctx.answerCallbackQuery()
})
```

- [ ] **Step 6: PASS**

Run: `pnpm --filter @devpinger/server test test/integration/hub-connections.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/bot/hub apps/server/src/services/connections.ts apps/server/test/integration/hub-connections.test.ts
git commit -m "bot(hub): Connections section with disconnect + repo/project entry"
```

---

### Task 8: Hub section — События

Раздел показывает inline c кнопками «Последние 20», «Статистика», «Мьюты». Сами обработчики переиспользуют существующие `/recent`, `/stats`, `/mutes` хендлеры.

**Files:**
- Create: `apps/server/src/bot/hub/events.ts`
- Modify: `apps/server/src/bot/hub/index.ts`
- Modify: `apps/server/src/bot/index.ts` (вынести `/recent`, `/stats`, `/mutes` в экспортируемые функции, чтобы переиспользовать из callback'ов; или просто вызывать через `dispatch` команды — проще через рефактор хендлеров)
- Create: `apps/server/test/integration/hub-events.test.ts`

- [ ] **Step 1: Извлечь хендлеры из `index.ts`**

В [apps/server/src/bot/index.ts](apps/server/src/bot/index.ts) текущие inline-функции `bot.command("recent", ...)`, `bot.command("stats", ...)`, `bot.command("mutes", ...)` обернуть в именованные:

```ts
const handleRecentCommand = async (ctx: BotContext): Promise<void> => {
	// текущее тело обработчика recent
}

const handleStatsCommand = async (ctx: BotContext): Promise<void> => {
	// текущее тело stats
}

const handleMutesCommand = async (ctx: BotContext): Promise<void> => {
	// текущее тело mutes
}

bot.command("recent", handleRecentCommand)
bot.command("stats", handleStatsCommand)
bot.command("mutes", handleMutesCommand)

export { handleRecentCommand, handleStatsCommand, handleMutesCommand }
```

- [ ] **Step 2: Failing-тест на секцию**

Создать [apps/server/test/integration/hub-events.test.ts](apps/server/test/integration/hub-events.test.ts):

```ts
import { describe, expect, it } from "vitest"
import { renderEventsSection } from "../../src/bot/hub/events.js"

describe("hub: events section", () => {
	it("renders 3 inline buttons and a close button", () => {
		const t = (k: string) => {
			const map: Record<string, string> = {
				"hubV2.events.title": "🔔 Events",
				"hubV2.events.recent": "📜 Last 20",
				"hubV2.events.stats": "📊 Stats",
				"hubV2.events.mutes": "🔕 Mutes",
				"hubV2.close": "✖ Close",
			}
			return map[k] ?? k
		}
		const r = renderEventsSection(t)
		expect(r.text).toContain("Events")
		const labels = r.keyboard.inline_keyboard.flat().map((b) => ("text" in b ? b.text : ""))
		expect(labels).toEqual(["📜 Last 20", "📊 Stats", "🔕 Mutes", "✖ Close"])
	})
})
```

- [ ] **Step 3: FAIL**

Run: `pnpm --filter @devpinger/server test test/integration/hub-events.test.ts`

Expected: FAIL.

- [ ] **Step 4: Реализовать**

Создать [apps/server/src/bot/hub/events.ts](apps/server/src/bot/hub/events.ts):

```ts
import type { Translator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"

export const renderEventsSection = (
	t: Translator,
): { text: string; keyboard: { inline_keyboard: { text: string; callback_data: string }[][] } } => {
	const kb = new InlineKeyboard()
		.text(t("hubV2.events.recent"), "hub:events:recent")
		.row()
		.text(t("hubV2.events.stats"), "hub:events:stats")
		.row()
		.text(t("hubV2.events.mutes"), "hub:events:mutes")
		.row()
		.text(t("hubV2.close"), "hub:close")
	return {
		text: t("hubV2.events.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as { text: string; callback_data: string }[][] },
	}
}
```

В `hub/index.ts` заменить заглушку для `events`:

```ts
case "events": {
	const rendered = renderEventsSection(ctx.t)
	await ctx.reply(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	break
}
```

И добавить callback-ы (импорты для извлечённых хендлеров):

```ts
bot.callbackQuery("hub:events:recent", async (ctx) => {
	await ctx.answerCallbackQuery()
	await handleRecentCommand(ctx as unknown as BotContext)
})

bot.callbackQuery("hub:events:stats", async (ctx) => {
	await ctx.answerCallbackQuery()
	await handleStatsCommand(ctx as unknown as BotContext)
})

bot.callbackQuery("hub:events:mutes", async (ctx) => {
	await ctx.answerCallbackQuery()
	await handleMutesCommand(ctx as unknown as BotContext)
})
```

- [ ] **Step 5: PASS**

Run: `pnpm --filter @devpinger/server test test/integration/hub-events.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/bot/hub apps/server/src/bot/index.ts apps/server/test/integration/hub-events.test.ts
git commit -m "bot(hub): Events section (recent/stats/mutes shortcuts)"
```

---

### Task 9: Hub section — Настройки + notify_self refactor

Раздел показывает: `🌐 Язык`, `🔔 Уведомления`, `👤 Аккаунт`. Уведомления переключают `notifySelfActions`. Аккаунт открывает submenu c экспортом и удалением.

Параллельно — убираем admin guard с `/notify_self` (см. spec §7).

**Files:**
- Create: `apps/server/src/bot/hub/settings.ts`
- Modify: `apps/server/src/bot/index.ts` (notify_self без admin guard + новые callback'и)
- Create: `apps/server/test/integration/hub-settings.test.ts`

- [ ] **Step 1: Убрать admin-only guard на `/notify_self`**

В [apps/server/src/bot/index.ts:245-261](apps/server/src/bot/index.ts:245) удалить условие `telegramId !== env.ADMIN_TELEGRAM_ID`:

```ts
bot.command("notify_self", async (ctx) => {
	const telegramId = ctx.from?.id
	if (!telegramId) return
	const user = await getUserByTelegramId(db, telegramId)
	if (!user) return
	const arg = ctx.match?.toString().trim().toLowerCase()
	if (arg === "on" || arg === "off") {
		const next = arg === "on"
		await setNotifySelfActions(db, user.id, next)
		await ctx.reply(next ? ctx.t("settings.notifySelfOn") : ctx.t("settings.notifySelfOff"))
		return
	}
	const state = user.notifySelfActions
		? ctx.t("settings.notifySelfOn")
		: ctx.t("settings.notifySelfOff")
	await ctx.reply(ctx.t("settings.notifySelfStatus", { state }))
})
```

- [ ] **Step 2: Failing-тест**

Создать [apps/server/test/integration/hub-settings.test.ts](apps/server/test/integration/hub-settings.test.ts):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDatabase, users } from "@devpinger/db"
import { eq } from "drizzle-orm"
import { renderSettingsSection, toggleNotifySelf } from "../../src/bot/hub/settings.js"
import { createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("hub: settings section", () => {
	let db: ReturnType<typeof createDatabase>

	beforeAll(() => {
		db = createDatabase(integrationDbUrl as string)
	})

	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("renders 3 entries with current language", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			if (k === "hubV2.settings.lang") return `🌐 Language: ${p?.current}`
			if (k === "hubV2.settings.title") return "⚙️ Settings"
			if (k === "hubV2.settings.notifications") return "🔔 Notifications"
			if (k === "hubV2.settings.account") return "👤 Account"
			if (k === "hubV2.close") return "✖ Close"
			return k
		}
		const r = renderSettingsSection(t, "ru")
		expect(r.text).toContain("Settings")
		expect(r.keyboard.inline_keyboard.flat().map((b) => "text" in b ? b.text : "")).toEqual([
			"🌐 Language: ru",
			"🔔 Notifications",
			"👤 Account",
			"✖ Close",
		])
	})

	it("toggleNotifySelf flips and returns the new state", async () => {
		const user = await createTestUser(db, { notifySelfActions: false })
		const after = await toggleNotifySelf(db, user.id)
		expect(after).toBe(true)
		const after2 = await toggleNotifySelf(db, user.id)
		expect(after2).toBe(false)
		const [row] = await db.select().from(users).where(eq(users.id, user.id))
		expect(row?.notifySelfActions).toBe(false)
	})
})
```

- [ ] **Step 3: FAIL**

Run: `pnpm --filter @devpinger/server test test/integration/hub-settings.test.ts`

Expected: FAIL.

- [ ] **Step 4: Реализовать модуль**

Создать [apps/server/src/bot/hub/settings.ts](apps/server/src/bot/hub/settings.ts):

```ts
import type { Locale, Translator } from "@devpinger/i18n"
import { users } from "@devpinger/db"
import { eq } from "drizzle-orm"
import { InlineKeyboard } from "grammy"
import type { db as Db } from "../../db.js"

export const renderSettingsSection = (
	t: Translator,
	currentLocale: Locale,
): { text: string; keyboard: { inline_keyboard: { text: string; callback_data: string }[][] } } => {
	const kb = new InlineKeyboard()
		.text(t("hubV2.settings.lang", { current: currentLocale }), "hub:settings:lang")
		.row()
		.text(t("hubV2.settings.notifications"), "hub:settings:notifications")
		.row()
		.text(t("hubV2.settings.account"), "hub:settings:account")
		.row()
		.text(t("hubV2.close"), "hub:close")
	return {
		text: t("hubV2.settings.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as { text: string; callback_data: string }[][] },
	}
}

export const renderNotificationsSubsection = (
	t: Translator,
	notifySelfActions: boolean,
): { text: string; keyboard: { inline_keyboard: { text: string; callback_data: string }[][] } } => {
	const stateLabel = notifySelfActions
		? t("hubV2.notifications.selfActionsOn")
		: t("hubV2.notifications.selfActionsOff")
	const kb = new InlineKeyboard()
		.text(stateLabel, "hub:settings:notify_self:toggle")
		.row()
		.text(t("hubV2.back"), "hub:open:settings")
	return {
		text: `${t("hubV2.notifications.title")}\n\n${t("hubV2.notifications.selfActionsHint")}`,
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as { text: string; callback_data: string }[][] },
	}
}

export const renderAccountSubsection = (
	t: Translator,
): { text: string; keyboard: { inline_keyboard: { text: string; callback_data: string }[][] } } => {
	const kb = new InlineKeyboard()
		.text(t("hubV2.account.export"), "hub:settings:account:export")
		.row()
		.text(t("hubV2.account.delete"), "hub:settings:account:delete")
		.row()
		.text(t("hubV2.back"), "hub:open:settings")
	return {
		text: t("hubV2.account.title"),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as { text: string; callback_data: string }[][] },
	}
}

export const toggleNotifySelf = async (db: typeof Db, userId: string): Promise<boolean> => {
	const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
	if (!row) throw new Error("user not found")
	const next = !row.notifySelfActions
	await db.update(users).set({ notifySelfActions: next }).where(eq(users.id, userId))
	return next
}
```

- [ ] **Step 5: Подключить callbacks в `hub/index.ts`**

```ts
case "settings": {
	const rendered = renderSettingsSection(ctx.t, ctx.locale)
	await ctx.reply(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	break
}
```

Добавить:

```ts
bot.callbackQuery("hub:open:settings", async (ctx) => {
	await ctx.answerCallbackQuery()
	const rendered = renderSettingsSection(ctx.t, ctx.locale)
	try {
		await ctx.editMessageText(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	} catch {
		await ctx.reply(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	}
})

bot.callbackQuery("hub:settings:lang", async (ctx) => {
	await ctx.answerCallbackQuery()
	const kb = new InlineKeyboard()
	for (const locale of SUPPORTED_LOCALES) {
		kb.text(locale === "en" ? "English" : "Русский", `lang:set:${locale}`).row()
	}
	await ctx.reply(ctx.t("settings.langPrompt"), { reply_markup: kb })
})

bot.callbackQuery("hub:settings:notifications", async (ctx) => {
	await ctx.answerCallbackQuery()
	const tgId = ctx.from?.id
	if (!tgId) return
	const user = await getUserByTelegramId(db, tgId)
	if (!user) return
	const rendered = renderNotificationsSubsection(ctx.t, user.notifySelfActions)
	try {
		await ctx.editMessageText(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	} catch {
		await ctx.reply(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	}
})

bot.callbackQuery("hub:settings:notify_self:toggle", async (ctx) => {
	const tgId = ctx.from?.id
	if (!tgId) {
		await ctx.answerCallbackQuery()
		return
	}
	const user = await getUserByTelegramId(db, tgId)
	if (!user) {
		await ctx.answerCallbackQuery()
		return
	}
	const next = await toggleNotifySelf(db, user.id)
	await ctx.answerCallbackQuery({
		text: next ? ctx.t("hubV2.notifications.selfActionsOn") : ctx.t("hubV2.notifications.selfActionsOff"),
	})
	const rendered = renderNotificationsSubsection(ctx.t, next)
	try {
		await ctx.editMessageReplyMarkup({ reply_markup: rendered.keyboard })
	} catch {
		// best-effort
	}
})

bot.callbackQuery("hub:settings:account", async (ctx) => {
	await ctx.answerCallbackQuery()
	const rendered = renderAccountSubsection(ctx.t)
	try {
		await ctx.editMessageText(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	} catch {
		await ctx.reply(rendered.text, { parse_mode: "HTML", reply_markup: rendered.keyboard })
	}
})

bot.callbackQuery("hub:settings:account:export", async (ctx) => {
	await ctx.answerCallbackQuery()
	await handleExportCommand(ctx as unknown as Parameters<typeof handleExportCommand>[0])
})

bot.callbackQuery("hub:settings:account:delete", async (ctx) => {
	await ctx.answerCallbackQuery()
	await handleUnsubscribeCommand(ctx as unknown as Parameters<typeof handleUnsubscribeCommand>[0])
})
```

Импорты: `SUPPORTED_LOCALES`, `InlineKeyboard`, `getUserByTelegramId`, `handleExportCommand`, `handleUnsubscribeCommand`, рендеры.

- [ ] **Step 6: PASS**

Run: `pnpm --filter @devpinger/server test test/integration/hub-settings.test.ts`

Expected: PASS.

- [ ] **Step 7: Follow-up на добавление мьюта**

В [apps/server/src/bot/index.ts](apps/server/src/bot/index.ts), в существующем callback `bot.callbackQuery(/^mute:create:(source|repo|project|event_type):([^:]+):(.+)$/, ...)` (около строки 382), после `await ctx.answerCallbackQuery({ text: created ? ... })` добавить:

```ts
if (created) {
	try {
		await ctx.reply(ctx.t("hubV2.mutesAdded"))
	} catch {
		// best-effort
	}
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/bot/hub apps/server/src/bot/index.ts apps/server/test/integration/hub-settings.test.ts
git commit -m "bot(hub): Settings + notify_self toggle (no more admin-only)"
```

---

### Task 10: Onboarding wizard

Wizard работает на трёх триггерах:
1. `/start` без аргумента и `connections.length === 0` → шаг 1.
2. `/start connected_github|connected_jira` (deep-link после OAuth) → шаг 2 (текст + автозапуск выбора repo/projects).
3. Первое срабатывание `repos:add` / `proj:add`, если у юзера `onboardingCompletedAt === null` → шаг 3 + установка `onboardingCompletedAt = now()`.

**Files:**
- Create: `apps/server/src/bot/onboarding.ts`
- Modify: `apps/server/src/bot/index.ts` (рефактор `/start`-handler'а, см. также Task 11)
- Modify: `apps/server/src/bot/repos.ts` и `apps/server/src/bot/projects.ts` (after-add hook)
- Modify: `apps/server/src/services/users.ts` (добавить `markOnboardingCompleted`)
- Create: `apps/server/test/integration/onboarding.test.ts`

- [ ] **Step 1: `markOnboardingCompleted` в users service**

В [apps/server/src/services/users.ts](apps/server/src/services/users.ts) добавить:

```ts
export const markOnboardingCompleted = async (db: typeof Db, id: string): Promise<void> => {
	await db.update(users).set({ onboardingCompletedAt: sql`now()` }).where(eq(users.id, id))
}
```

- [ ] **Step 2: Failing-тест on onboarding messages**

Создать [apps/server/test/integration/onboarding.test.ts](apps/server/test/integration/onboarding.test.ts):

```ts
import { describe, expect, it, vi } from "vitest"
import { renderOnboardingStep1, renderOnboardingStep2, renderOnboardingStep3 } from "../../src/bot/onboarding.js"

describe("onboarding renderers", () => {
	it("step 1 has welcome + 2 OAuth url buttons", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			const map: Record<string, string> = {
				"onboarding.welcome": `Hi ${p?.username}!`,
				"onboarding.step1Title": "Step 1 of 3",
				"onboarding.step1Body": "pick one",
				"hubV2.connections.githubConnect": "🐙 Connect GitHub",
				"hubV2.connections.jiraConnect": "🟦 Connect Jira",
			}
			return map[k] ?? k
		}
		const r = renderOnboardingStep1({
			t,
			username: "octo",
			githubOauthUrl: "https://x/gh",
			jiraOauthUrl: "https://x/ji",
		})
		expect(r.welcome).toContain("Hi octo")
		expect(r.step.text).toContain("Step 1 of 3")
		const buttons = r.step.keyboard.inline_keyboard.flat()
		expect(buttons.some((b) => "url" in b && b.url === "https://x/gh")).toBe(true)
		expect(buttons.some((b) => "url" in b && b.url === "https://x/ji")).toBe(true)
	})

	it("step 2 includes provider name and CTA to repos/projects", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			if (k === "onboarding.step2Title") return `✅ ${p?.provider} connected. Step 2`
			if (k === "hubV2.connections.openRepos") return "📁 Repositories"
			return k
		}
		const r = renderOnboardingStep2({ t, provider: "github" })
		expect(r.text).toContain("github connected")
		expect(r.keyboard.inline_keyboard.flat().some((b) => "text" in b && b.text === "📁 Repositories")).toBe(true)
	})

	it("step 3 includes the connected target", () => {
		const t = (k: string, p?: Record<string, string | number>) => {
			if (k === "onboarding.step3Title") return `Done! ${p?.target} connected`
			if (k === "onboarding.step3Body") return "wait for first event"
			return k
		}
		const r = renderOnboardingStep3({ t, target: "octocat/example" })
		expect(r.text).toContain("octocat/example")
		expect(r.text).toContain("wait for first event")
	})
})
```

- [ ] **Step 3: FAIL**

Run: `pnpm --filter @devpinger/server test test/integration/onboarding.test.ts`

Expected: FAIL.

- [ ] **Step 4: Реализовать рендеры**

Создать [apps/server/src/bot/onboarding.ts](apps/server/src/bot/onboarding.ts):

```ts
import type { Translator } from "@devpinger/i18n"
import { InlineKeyboard } from "grammy"

export interface OnboardingStep1Input {
	t: Translator
	username: string | null
	githubOauthUrl: string
	jiraOauthUrl: string
}

export const renderOnboardingStep1 = (
	input: OnboardingStep1Input,
): {
	welcome: string
	step: {
		text: string
		keyboard: { inline_keyboard: ({ text: string; url: string } | { text: string; callback_data: string })[][] }
	}
} => {
	const { t, username, githubOauthUrl, jiraOauthUrl } = input
	const welcome = username ? t("onboarding.welcome", { username }) : t("onboarding.welcomeFallback")
	const stepText = `${t("onboarding.step1Title")}\n\n${t("onboarding.step1Body")}`
	const kb = new InlineKeyboard()
		.url(t("hubV2.connections.githubConnect"), githubOauthUrl)
		.row()
		.url(t("hubV2.connections.jiraConnect"), jiraOauthUrl)
	return {
		welcome,
		step: {
			text: stepText,
			keyboard: { inline_keyboard: kb.inline_keyboard as unknown as ({ text: string; url: string } | { text: string; callback_data: string })[][] },
		},
	}
}

export interface OnboardingStep2Input {
	t: Translator
	provider: "github" | "jira"
}

export const renderOnboardingStep2 = (
	input: OnboardingStep2Input,
): { text: string; keyboard: { inline_keyboard: { text: string; callback_data: string }[][] } } => {
	const { t, provider } = input
	const cta = provider === "github"
		? { label: t("hubV2.connections.openRepos"), data: "hub:conn:open:repos" }
		: { label: t("hubV2.connections.openProjects"), data: "hub:conn:open:projects" }
	const kb = new InlineKeyboard().text(cta.label, cta.data)
	return {
		text: t("onboarding.step2Title", { provider }),
		keyboard: { inline_keyboard: kb.inline_keyboard as unknown as { text: string; callback_data: string }[][] },
	}
}

export interface OnboardingStep3Input {
	t: Translator
	target: string
}

export const renderOnboardingStep3 = (
	input: OnboardingStep3Input,
): { text: string } => {
	const { t, target } = input
	return {
		text: `${t("onboarding.step3Title", { target })}\n\n${t("onboarding.step3Body")}`,
	}
}
```

- [ ] **Step 5: Подключить wizard в `/start` и в repo/proj add hooks**

В [apps/server/src/bot/index.ts](apps/server/src/bot/index.ts) переписать обработчик `bot.command("start", ...)` (полностью — он станет adaptive в Task 11):

```ts
bot.command("start", async (ctx) => {
	const payload = ctx.match?.toString().trim() ?? ""
	const tgId = ctx.from?.id
	if (!tgId) return
	const user = await getUserByTelegramId(db, tgId)
	if (!user) return

	// Existing deep-link cases first
	if (payload === "connected_github" || payload === "connected_jira") {
		const provider = payload === "connected_github" ? "github" : "jira"
		const r = renderOnboardingStep2({ t: ctx.t, provider })
		await ctx.reply(r.text, { parse_mode: "HTML", reply_markup: r.keyboard })
		return
	}

	if (payload.startsWith("event_")) {
		// existing event deep-link branch as is
		return
	}

	// Adaptive (will be expanded in Task 11)
	const connectedCount = (await listConnectedProviders(db, user.id)).size
	if (connectedCount === 0 && user.onboardingCompletedAt === null) {
		const sig = (provider: "github" | "jira") =>
			signTg(tgId, `oauth-${provider}-start`, env.ENCRYPTION_KEY)
		const oauthUrl = (provider: "github" | "jira") =>
			`${env.PUBLIC_BASE_URL}/oauth/${provider}/start?sig=${sig(provider)}`
		const s1 = renderOnboardingStep1({
			t: ctx.t,
			username: ctx.from?.username ?? null,
			githubOauthUrl: oauthUrl("github"),
			jiraOauthUrl: oauthUrl("jira"),
		})
		await ctx.reply(s1.welcome, { parse_mode: "HTML" })
		await ctx.reply(s1.step.text, {
			parse_mode: "HTML",
			reply_markup: s1.step.keyboard,
		})
		return
	}

	// existing welcome (will be replaced in Task 11)
	const username = ctx.from?.username
	const text = username ? ctx.t("start.welcome", { username }) : ctx.t("start.welcomeFallback")
	await ctx.reply(text, { reply_markup: await buildStartMenu(ctx) })
})
```

Импорты: `renderOnboardingStep1`, `renderOnboardingStep2`.

В [apps/server/src/bot/repos.ts](apps/server/src/bot/repos.ts) и [apps/server/src/bot/projects.ts](apps/server/src/bot/projects.ts), внутри `handleRepoAdd` / `handleProjectAdd` после успешного добавления (там, где идёт `await ctx.reply(t("repos.added"), ...)` / `t("jiraProjects.added")`), добавить hook:

```ts
if (user.onboardingCompletedAt === null) {
	const s3 = renderOnboardingStep3({ t: ctx.t, target: fullName })
	await ctx.reply(s3.text, {
		parse_mode: "HTML",
		reply_markup: { keyboard: mainReplyKeyboard(ctx.t).build(), resize_keyboard: true, is_persistent: true },
	})
	await markOnboardingCompleted(db, user.id)
}
```

(`target` в `repos.ts` — `fullName`; в `projects.ts` — `key`.)

- [ ] **Step 6: PASS**

Run: `pnpm --filter @devpinger/server test test/integration/onboarding.test.ts`

Expected: PASS.

- [ ] **Step 7: Полный typecheck**

Run: `pnpm --filter @devpinger/server typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/bot/onboarding.ts apps/server/src/bot/index.ts apps/server/src/bot/repos.ts apps/server/src/bot/projects.ts apps/server/src/services/users.ts apps/server/test/integration/onboarding.test.ts
git commit -m "bot: 3-step onboarding wizard + onboardingCompletedAt persistence"
```

---

### Task 11: Adaptive `/start` для существующего юзера

Если у пользователя уже есть хотя бы одно подключение **или** `onboardingCompletedAt !== null` — показываем краткий summary вместо welcome.

**Files:**
- Modify: `apps/server/src/bot/index.ts` (доделать `/start`)
- Create: `apps/server/src/services/history.ts` (добавить `countEventsLast7d`)
- Create: `apps/server/test/integration/start-adaptive.test.ts`

- [ ] **Step 1: Добавить `countEventsLast7d`**

В [apps/server/src/services/history.ts](apps/server/src/services/history.ts) добавить (если функции нет — гляну дальше; сейчас в файле уже есть `userStats`, `recentEvents`):

```ts
import { sql } from "drizzle-orm"

export const countEventsLast7d = async (db: typeof Db, userId: string): Promise<number> => {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(events)
		.where(
			and(
				eq(events.userId, userId),
				sql`${events.receivedAt} > now() - interval '7 days'`,
			),
		)
	return Number(row?.n ?? 0)
}
```

(импорты: уже есть `events`, `and`, `eq` — добавить `sql` если нет.)

- [ ] **Step 2: Failing-тест**

Создать [apps/server/test/integration/start-adaptive.test.ts](apps/server/test/integration/start-adaptive.test.ts):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDatabase } from "@devpinger/db"
import { renderAdaptiveStart } from "../../src/bot/onboarding.js"
import { addGitHubConnection, createTestUser } from "./helpers/seed.js"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

describe.skipIf(skip)("renderAdaptiveStart", () => {
	let db: ReturnType<typeof createDatabase>
	beforeAll(() => {
		db = createDatabase(integrationDbUrl as string)
	})
	afterAll(async () => {
		await db.$client.end({ timeout: 5 })
	})

	it("shows N connections and pluralizes the word", async () => {
		const user = await createTestUser(db, { telegramUsername: "octo" })
		await addGitHubConnection(db, user.id, { username: "octocat" })

		const text = await renderAdaptiveStart({
			db,
			userId: user.id,
			t: (k, p) =>
				k === "startAdaptive"
					? `Hi ${p?.username}, ${p?.connectionsCount} ${p?.connectionsWord}, ${p?.eventsLast7d} events`
					: k,
			username: "octo",
			locale: "en",
		})
		expect(text).toMatch(/Hi octo, 1 connection, \d+ events/)
	})
})
```

- [ ] **Step 3: FAIL**

Run: `pnpm --filter @devpinger/server test test/integration/start-adaptive.test.ts`

Expected: FAIL (`renderAdaptiveStart` не экспортирован).

- [ ] **Step 4: Реализовать `renderAdaptiveStart`**

В [apps/server/src/bot/onboarding.ts](apps/server/src/bot/onboarding.ts) добавить:

```ts
import { listConnectedProviders } from "../services/connections.js"
import { countEventsLast7d } from "../services/history.js"
import type { Locale, Translator } from "@devpinger/i18n"
import type { db as Db } from "../db.js"

const pluralizeConnections = (n: number, locale: Locale): string => {
	if (locale === "ru") {
		const lastTwo = n % 100
		const last = n % 10
		if (lastTwo >= 11 && lastTwo <= 14) return "подключений"
		if (last === 1) return "подключение"
		if (last >= 2 && last <= 4) return "подключения"
		return "подключений"
	}
	return n === 1 ? "connection" : "connections"
}

export interface RenderAdaptiveStartInput {
	db: typeof Db
	userId: string
	t: Translator
	username: string | null
	locale: Locale
}

export const renderAdaptiveStart = async (input: RenderAdaptiveStartInput): Promise<string> => {
	const { db, userId, t, username, locale } = input
	const connectionsCount = (await listConnectedProviders(db, userId)).size
	const eventsLast7d = await countEventsLast7d(db, userId)
	return t("startAdaptive", {
		username: username ?? "",
		connectionsCount,
		connectionsWord: pluralizeConnections(connectionsCount, locale),
		eventsLast7d,
	})
}
```

В `/start`-handler'е в `apps/server/src/bot/index.ts` заменить «existing welcome (will be replaced in Task 11)» блок на:

```ts
const text = await renderAdaptiveStart({
	db,
	userId: user.id,
	t: ctx.t,
	username: ctx.from?.username ?? null,
	locale: ctx.locale,
})
await ctx.reply(text, {
	parse_mode: "HTML",
	reply_markup: { keyboard: mainReplyKeyboard(ctx.t).build(), resize_keyboard: true, is_persistent: true },
})
```

И удалить вызов `buildStartMenu` (вместе с самой функцией `buildStartMenu`, которая в `index.ts:65-91` — она была inline-меню старого стиля, больше не нужна).

- [ ] **Step 5: PASS**

Run: `pnpm --filter @devpinger/server test test/integration/start-adaptive.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/history.ts apps/server/src/bot/onboarding.ts apps/server/src/bot/index.ts apps/server/test/integration/start-adaptive.test.ts
git commit -m "bot: adaptive /start summary for returning users"
```

---

### Task 12: Worker first-event follow-up + cleanup устаревших i18n ключей

После того как воркер впервые успешно отправил событие пользователю (`events.count() === 1` для этого `userId`), отправить однократно подсказку «👋 Первое событие!» и зафиксировать `users.firstEventNotifiedAt`. Идемпотентно — на повторный запуск не дублируется.

Также чистим устаревшие i18n блоки (`hub`, `mainKeyboard`, `start.welcome`/`welcomeFallback` старые, `help.text`, `menu.settings`, `settings.comingSoon`).

**Files:**
- Modify: `apps/worker/src/handlers/notification.ts` (по факту это `processNotificationJob` или похожий — найти место, где после успешной отправки можно вставить hook)
- Create: `apps/server/src/services/first-event.ts` (логика «первый раз» — `markFirstEventNotified`)
- Modify: `packages/i18n/src/messages/en/bot.json`, `packages/i18n/src/messages/ru/bot.json` (удалить устаревшее)
- Create: `apps/worker/test/integration/first-event-followup.test.ts` (если папка/конфиг есть; иначе пропустить, прогон вживую)

- [ ] **Step 1: Найти worker'ский notification-handler**

Run: `grep -rn "notify-send" apps/worker/src 2>/dev/null || grep -rn "sendNotification\|notifyUser" apps/worker/src`

Прочитать найденный файл. Найти place где после успешной отправки в Telegram («delivered=true») можно сделать `if (eventsForUser.count === 1) ...`. Если такого hook'а нет — добавить рядом с записью `events.deliveredAt`.

- [ ] **Step 2: Реализовать idempotent helper**

Создать [apps/server/src/services/first-event.ts](apps/server/src/services/first-event.ts):

```ts
import { users, events } from "@devpinger/db"
import { count, eq } from "drizzle-orm"
import type { db as Db } from "../db.js"

export interface MaybeNotifyFirstEventResult {
	shouldSendFollowUp: boolean
}

export const maybeMarkFirstEvent = async (
	db: typeof Db,
	userId: string,
): Promise<MaybeNotifyFirstEventResult> => {
	const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
	if (!userRow) return { shouldSendFollowUp: false }
	if (userRow.firstEventNotifiedAt !== null) return { shouldSendFollowUp: false }
	const [agg] = await db.select({ n: count() }).from(events).where(eq(events.userId, userId))
	const delivered = Number(agg?.n ?? 0)
	if (delivered < 1) return { shouldSendFollowUp: false }
	const result = await db
		.update(users)
		.set({ firstEventNotifiedAt: new Date() })
		.where(eq(users.id, userId))
		.returning({ id: users.id })
	return { shouldSendFollowUp: result.length > 0 }
}
```

(Это файл живёт в `apps/server/src/services`. Worker импортирует его как локальный путь — в Task 12 шаг 3 решим, как именно.)

- [ ] **Step 3: Вставить hook в worker**

В найденном worker'ском handler'е (из Step 1) после `await sendTelegramMessage(...)` (или эквивалента) добавить:

```ts
import { maybeMarkFirstEvent } from "@devpinger/server-shared/first-event.js" // см. ниже
import { botMessages } from "@devpinger/i18n"

// ...

const { shouldSendFollowUp } = await maybeMarkFirstEvent(db, userId)
if (shouldSendFollowUp) {
	const locale = userRow.lang === "ru" ? "ru" : "en"
	await bot.api.sendMessage(userRow.telegramChatId, botMessages[locale].onboarding.firstEvent, {
		parse_mode: "HTML",
	})
}
```

Импорт `maybeMarkFirstEvent` сейчас сложный — она живёт в `apps/server/src/services`. Варианта три:

a) Дублировать функцию в `apps/worker/src/services/first-event.ts` (минус — DRY-нарушение).
b) Перевести в `@devpinger/db` как helper (плюс — общий пакет; минус — db package сейчас чистый schema).
c) Перевести в новый workspace-пакет `@devpinger/server-shared` (heavy).

Выбираем **(a)**: дублировать в worker — это 15 строк, дешевле, чем новый пакет. Файл — [apps/worker/src/services/first-event.ts](apps/worker/src/services/first-event.ts), содержание копируется 1-в-1.

- [ ] **Step 4: Test (или вживую)**

Если интеграционные тесты worker'а есть — добавить файл `apps/worker/test/integration/first-event-followup.test.ts` (структура аналогична оборудуованным `apps/server/test/integration`). Если нет — пропустить шаг и проверить вживую: на staging-юзере сделать событие, убедиться что приходит follow-up; послать второе — follow-up не приходит.

Run (если тест есть): `pnpm --filter @devpinger/worker test`

Expected: PASS.

- [ ] **Step 5: Удалить устаревшие i18n-ключи**

В [packages/i18n/src/messages/en/bot.json](packages/i18n/src/messages/en/bot.json) и [packages/i18n/src/messages/ru/bot.json](packages/i18n/src/messages/ru/bot.json) удалить блоки:
- `hub` (старый, неиспользуемый)
- `mainKeyboard`
- `menu` (старый — `connectGithub`, `connectJira`, `connectedHint`, `settings`, `help`, `language`) — заменены на `hubV2.connections.*` и `replyKeyboard.*`
- `start.welcome`, `start.welcomeFallback` — заменены на `onboarding.welcome` / `onboarding.welcomeFallback`
- `help.text` — заменён на `helpV2.text`
- `sources.*` — раздел упразднён (упоминается только в hidden `/sources` команде; либо тоже удалить, либо оставить — на твоё усмотрение)

Прогнать `pnpm -r typecheck` после удалений. Если что-то ломается — значит код где-то ссылается на старый ключ; поправить.

- [ ] **Step 6: Финальный прогон всей сюйты**

Run: `pnpm --filter @devpinger/server test && pnpm --filter @devpinger/worker test`

Expected: всё зелёное.

- [ ] **Step 7: Commit**

```bash
git add apps/worker apps/server/src/services/first-event.ts packages/i18n/src/messages
git commit -m "worker: first-event follow-up + i18n cleanup of legacy keys"
```

---

## Self-review

**Spec coverage** (по разделам спеки):
- §1 Telegram BotFather metadata — Task 3. ✓
- §2 Reply-keyboard 2×2 — Task 6 (helper) + везде, где привязывается к `/start` (Task 10, 11). ✓
- §3 Hub разделы (Подключения / События / Настройки / Помощь) — Tasks 7, 8, 9, и Help — Task 5 (вызывается и из reply-keyboard, и из `/help`). ✓
- §4 Onboarding 4 сообщения — Task 10. ✓
- §5 Adaptive `/start` — Task 11. ✓
- §6 Контекстные follow-up — частично: «✅ {fullName} подключён → шаг 2» закрывается onboarding step3, «первое событие» — Task 12. Follow-up «🔕 Мьют добавлен. Управление — Настройки → 🔕 Мьюты.» — **gap**, дописать в `mutes`-handler в Task 9 (либо в отдельную мини-задачу). Достаточно одной строки `ctx.reply(t("hubV2.mutesAdded"))` после `addMute` callback. → **fix inline**: добавить i18n-ключ `hubV2.mutesAdded` в Task 2, и шаг в Task 9 для дописки в существующий `mute:create:...` callback.
- §7 Refactor `/notify_self` — Task 9. ✓
- §8 Slash-команды в Telegram menu — Task 4. ✓
- §9 Refactor `/help` — Task 5. ✓

**Placeholder scan:** Ни одного "TBD", "TODO" в коде. Шаг 1 в Task 12 содержит `grep` для поиска handler'а — это не placeholder, а необходимая ориентация, поскольку worker'ский notification-flow я не читал в этой сессии.

**Type consistency:**
- `renderConnectionsSection` / `renderEventsSection` / `renderSettingsSection` все возвращают `{ text, keyboard }` где `keyboard: { inline_keyboard: ... }`. ✓
- `mainReplyKeyboard` возвращает `Keyboard`, который билдится через `.build()` или передаётся в `reply_markup` напрямую. Я использую `.build()` плюс ручное обёртывание `{ keyboard: ..., resize_keyboard: ..., is_persistent: ... }` — это эквивалентно `kb.toJSON()` в grammy. Если в реализации возникнет неудобство, можно заменить на `reply_markup: kb`. ✓
- `markOnboardingCompleted` и `toggleNotifySelf` — обе изменяют `users`, сигнатуры согласованы. ✓

**Inline fix:** Добавить шаг в Task 2 на ключ `hubV2.mutesAdded` (ru: "🔕 Мьют добавлен. Управление — Настройки → 🔕 Мьюты."; en: "🔕 Mute added. Manage — Settings → 🔕 Mutes."). Добавить шаг в Task 9 для дописки в существующий callback `mute:create:...` в `index.ts:382`:
```ts
if (created) await ctx.reply(ctx.t("hubV2.mutesAdded"))
```

После применения этих fix'ов — план самодостаточен.
