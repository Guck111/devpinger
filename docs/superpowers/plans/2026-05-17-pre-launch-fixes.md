# Pre-Launch Fixes — DevPinger

> **Для агентов:** обязательная под-скилла — `superpowers:subagent-driven-development` или `superpowers:executing-plans` для пошагового исполнения. Все шаги — чекбоксы (`- [ ]`).

**Цель:** закрыть блокеры безопасности и привести лендинг/Terms/Privacy/docs к реальности в коде до пуска платного трафика на `preorder.devpinger.com`.

**Архитектура решения:** ничего не переписываем — только локальные правки в копировании, env-схеме, формате клавиатуры и роутах. Stripe-функции остаются в коде, но позиционируются на лендинге как paid-only (а не «coming in 60 days»). GitHub webhook lookup переезжает на per-subscription URL для O(1).

**Стек:** TypeScript / Fastify / Drizzle / grammy / Astro (лендинг). pnpm monorepo.

**Контекст:** полный pre-launch аудит выполнен 2026-05-17 (smoke-результаты в чате). Все цитаты `file:line` ниже верифицированы против HEAD.

---

## Фаза A — Блокеры запуска (выполнить до отправки трафика)

### Task A1: Обновить drizzle-orm до patched-версии (CVE-2026-39356)

**Файлы:**
- Modify: `apps/server/package.json:30`
- Modify: `apps/worker/package.json:24`
- Modify: `packages/db/package.json:24`
- Modify (если есть `drizzle-kit`): тот же файл

**Why:** `pnpm audit --prod` подтверждает HIGH (CVSS 7.5), patched `>=0.45.2`. В коде нет `sql.identifier`/`sql.raw` с user input, но library-level escape сломан — будущий рефакторинг с динамической сортировкой моментально станет SQL-инъекцией.

- [ ] **Step 1: Заменить `^0.38.3` на `^0.45.2`** в трёх `package.json`.
- [ ] **Step 2: `pnpm install` в корне workspace.**
- [ ] **Step 3: `pnpm --filter @devpinger/db db:generate` и проверить, что схема не дрифтует.** Если drizzle-kit бампается синхронно — пересгенерировать снапшоты в `packages/db/drizzle/meta/`.
- [ ] **Step 4: `pnpm test`** — все 126+ серверных тестов должны пройти. Особое внимание на `apps/server/test/integration/notification-dispatch.test.ts`, `oauth-*.test.ts`, `webhooks-jira-*.test.ts`.
- [ ] **Step 5: `pnpm audit --prod`** — drizzle-orm advisory должен исчезнуть.
- [ ] **Step 6: Commit.**

```bash
git add apps/server/package.json apps/worker/package.json packages/db/package.json pnpm-lock.yaml
git commit -m "chore(deps): bump drizzle-orm to 0.45.2 (CVE-2026-39356)"
```

---

### Task A2: GitHub webhook lookup — per-subscription URL вместо O(N) HMAC-перебора

**Файлы:**
- Modify: `packages/sources/github/src/adapter.ts:172-189` (URL при `setupRepoWebhook`)
- Modify: `apps/server/src/routes/webhooks/github.ts` (роут принимает `:subscriptionId`)
- Modify: `apps/server/src/services/ingest.ts:18-35` (`githubLookup` использует `pathParam` вместо `findActiveSubscriptionsByProvider`)
- Test: `apps/server/test/integration/webhooks-github-*.test.ts` (надо посмотреть, какие конкретно — grep)

**Why:** сейчас `POST /webhooks/github` грузит **все** активные подписки по всем юзерам и крутит HMAC-SHA256 на rawBody (до 1 МБ) — `services/ingest.ts:18-35`. Тривиальный CPU-DoS-вектор, который усиливается с ростом N. Опубликовать роут публично без этого — приглашение красноглазых.

- [ ] **Step 1: Прочитать существующие e2e тесты GitHub-webhook**, чтобы понять контракт (`apps/server/test/integration/`).
- [ ] **Step 2: Написать failing test:** `POST /webhooks/github/<sub-id>` с правильной подписью → 200, событие в `events`; неверный `sub-id` → 404; правильный `sub-id` + неверная подпись → 401.
- [ ] **Step 3: Обновить роут.** Меняем `app.post("/webhooks/github", ...)` на `app.post("/webhooks/github/:subscriptionId", ...)` в `apps/server/src/routes/webhooks/github.ts`. Передаём `pathParam` в `ingestWebhook`.
- [ ] **Step 4: Обновить `githubLookup` в `services/ingest.ts`** — вместо `findActiveSubscriptionsByProvider` использовать `findSubscriptionById(db, pathParam)` с проверкой `provider === "github"` и `isActive`. Затем верифицировать HMAC только против `sub.webhookSecret`.
- [ ] **Step 5: Обновить `setupRepoWebhook`** в `packages/sources/github/src/adapter.ts:172-189`: URL вебхука = `${PUBLIC_BASE_URL}/webhooks/github/${subscriptionId}`.
- [ ] **Step 6: Backward compatibility.** Старые GitHub-подписки уже зарегистрированы по `/webhooks/github` без `:id`. Два варианта:
  - **Опция А (рекомендую):** оставить fallback-роут `app.post("/webhooks/github", ...)` который продолжает работать через старый O(N) lookup. Удалить после миграционного периода (2-4 недели).
  - **Опция Б:** скриптом пройти по всем `subscriptions` где `provider="github"`, дёрнуть GitHub API `PATCH /repos/.../hooks/{hook_id}` чтобы обновить `config.url`. Требует свежий OAuth-токен — у части юзеров может быть expired.
- [ ] **Step 7: Снизить rate-limit на `/webhooks/github/:id` до ~60/min/IP.** В Fastify `routeOptions.config.rateLimit = { max: 60, timeWindow: "1 minute" }`. Глобальный 600/мин — слишком расслабленный для публичной HMAC-машинки.
- [ ] **Step 8: Run tests, verify all pass.**
- [ ] **Step 9: Commit.**

```bash
git add apps/server/src/routes/webhooks/github.ts apps/server/src/services/ingest.ts packages/sources/github/src/adapter.ts apps/server/test/
git commit -m "feat(webhooks): per-subscription github URL for O(1) lookup + rate-limit"
```

---

### Task A3: Привести ROADMAP.md к реальности (Stripe **в** public-репо)

**Файлы:**
- Modify: `docs/ROADMAP.md:33,64,75-83,100`

**Why:** ROADMAP сейчас обещает, что в public-репо никогда не будет «`stripe_*` columns or tables», «Stripe imports or env variables», «`/billing/*` routes». Реальность: все три условия нарушены (`packages/db/drizzle/0006_pale_lyja.sql`, `packages/shared/src/env.ts:40`, `apps/server/src/routes/webhooks/stripe.ts`). Любой потенциальный self-hoster видит противоречие в первом же файле и теряет доверие.

- [ ] **Step 1: Прочитать ROADMAP.md целиком.**
- [ ] **Step 2: Заменить раздел про «public stays free of Stripe/billing»** — описать так, как есть: «preorder webhook и таблица `preorders` лежат в public-репо как часть smoke-test flow; Pro-биллинг (subscriptions, `/billing/*` routes, plan gate) — в отдельном private-репо».
- [ ] **Step 3: Убрать строки 75-83 списком («public stays free of: ...»)** или переписать в «public содержит: preorder webhook, landing_subscribers table, preorders table. Private содержит: stripe customer/subscription logic, `/billing/*`, stripePlanGate».
- [ ] **Step 4: Сверить с реальностью** — что именно из «Stripe» лежит в public, и что планируется в private. Перечислить честно.
- [ ] **Step 5: Commit.**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): reconcile public-vs-private split with current code"
```

---

### Task A4: Лендинг — Stripe/Sentry как paid-only, не «soon ≤60d»

**Файлы:**
- Modify: `apps/landing/src/pages/index.astro` (или в отдельном репо `preorder/src/pages/index.astro` — смотри куда задеплоен `preorder.devpinger.com`)

**Why:** пользователь сменил позиционирование — Stripe и Sentry будут только в платной подписке. Compare table сейчас ставит им `✓ soon · ≤60d` (`index.astro:858,864,870`) — это создаёт ожидание «получишь за $9 lifetime через 60 дней». Нужно явно: «GitHub + Jira — free и в lifetime; Stripe + Sentry — paid plan, $19/мес после launch».

- [ ] **Step 1: Hero H1 и meta:** «Don't miss a failed payment» (`index.astro:10-12,670-674`). Решить:
  - Опция А: оставить H1 (sells `$9 lifetime` через эмоцию failed payment), но в hero-trust строке добавить **«Stripe via $19/mo plan (after launch)»**.
  - Опция Б: переписать H1 на нейтральное «Ship-shape Telegram alerts for your dev stack» или подобное. Сохранит soul, не обещает Stripe в lifetime.
- [ ] **Step 2: Compare table** (`index.astro:855-870`). Поменять `✓ soon · ≤60d` на `✓ Pro plan` для строк «Stripe failed payments», «Stripe disputes», «Sentry spikes». Добавить footnote: «Pro features ship after launch; lifetime $9 covers GitHub + Jira».
- [ ] **Step 3: Pricing card $9 lifetime** (`index.astro:917-924`). Убрать «Stripe + Sentry (≤60 days)» из feature-list. Оставить:
  - GitHub + Jira (works today)
  - Lifetime updates for GitHub/Jira features
  - 30-day money back guarantee (см. A6)
- [ ] **Step 4: Pricing card $19/мес Monthly Pro** (`index.astro:935-941`). Здесь перечислить Stripe failed payments / disputes / Sentry spikes как included.
- [ ] **Step 5: Step-by-step section** (`index.astro:818`). Убрать «Stripe and Sentry within 60 days». Заменить на «Stripe and Sentry в Pro плане».
- [ ] **Step 6: Section heading `s4.caption`** (`index.astro:900`). «Built for the dev who doesn't have a corporate Slack but does have a Stripe account» — оставить, это про ICP, не обещание.
- [ ] **Step 7: FAQ блок «When will Stripe and Sentry sources ship?»** (`index.astro:965-970`). Переписать: «Stripe and Sentry land in our Pro plan ($19/mo) shortly after launch. The $9 lifetime preorder covers GitHub + Jira indefinitely.»
- [ ] **Step 8: FAQ «What if you don't deliver in 60 days?»** (`index.astro:975-980`). Снять — обещание было привязано к Stripe/Sentry за 60 дней. Заменить на «30-day money back если что-то пошло не так с GitHub/Jira».
- [ ] **Step 9: Telegram mocks** (`index.astro:712-798`). Stripe failed payment + dispute mocks — оставить, но **в caption под секцией** дописать «Pro plan preview». Mock GitHub PR — оставить как есть.
- [ ] **Step 10: Дублировать все изменения в RU-блок** (`index.astro:1189+`).
- [ ] **Step 11: `pnpm --filter ... build`** лендинга, открыть локально, прокликать.
- [ ] **Step 12: Commit.**

```bash
git add apps/landing/src/pages/index.astro  # или preorder/src/pages/index.astro
git commit -m "landing: reposition stripe/sentry as paid-plan features (not 60-day promise)"
```

---

### Task A5: Thank-you page — убрать обещание «email within 24 hours» и bi-weekly emails

**Файлы:**
- Modify: `preorder/src/pages/thank-you.astro:20-25,42-47`

**Why:** код Stripe-webhook'а (`apps/server/src/routes/webhooks/stripe.ts:160-162`) шлёт TG-уведомление **только админу**, не покупателю. Email-провайдер не подключён нигде. Обещание «email from me (Arseni) within 24 hours» — manual process, который ты можешь пропустить. После A4 (Stripe = paid only) обещание «Stripe в течение 60 дней» вообще теряет смысл.

- [ ] **Step 1: EN-блок (`thank-you.astro:17-25`).** Заменить список на:
  ```
  1. Open @dev_pinger_bot in Telegram → /start. Your purchase is linked
     by the Telegram username you provided at checkout.
  2. Connect GitHub and/or Jira via /repos and /projects.
  3. Stripe and Sentry land in our Pro plan after launch — your $9
     lifetime keeps GitHub + Jira free forever.
  4. Bug, idea, or feedback? Reply on Telegram or email
     info@devpinger.com — you're in the first 30, your voice counts.
  ```
- [ ] **Step 2: RU-блок (`thank-you.astro:38-47`).** Зеркальный перевод.
- [ ] **Step 3: Локально проверить, что страница рендерится.**
- [ ] **Step 4: Commit.**

```bash
git add preorder/src/pages/thank-you.astro
git commit -m "landing(thank-you): drop manual-email promise; point to bot directly"
```

---

### Task A6: Terms — синхронизировать refund language с FAQ и новой моделью

**Файлы:**
- Modify: `preorder/src/pages/terms.astro:22-31,53-65`

**Why:** Terms говорят «email within 14 days, refunds manual» (`terms.astro:23`), а FAQ на лендинге обещает «Full refund, one click. No questions, no negotiation» (`index.astro:980`). После A4 (Stripe убран из 60-day обещания) нужно переписать refund policy: «30-day money back с момента покупки, без вопросов; refunds процессим вручную по email».

- [ ] **Step 1: EN-блок (`terms.astro:19-31`).** Переписать в один раздел:
  ```
  ## What you're buying
  One-time $9 USD for lifetime access to DevPinger Pro features for
  GitHub and Jira sources. The bot works today.

  ## Refund policy
  Within 30 days of purchase, full refund — no questions, no
  negotiation. Email info@devpinger.com with your Stripe receipt and
  we'll process it manually within 7 business days. After 30 days
  refunds are at our discretion.

  ## Stripe and Sentry sources (Pro plan)
  Stripe failed-payment and Sentry error sources will ship in the
  paid Pro plan ($19/mo) after public launch. They are NOT included
  in this $9 lifetime preorder. Your lifetime access covers GitHub
  and Jira indefinitely.
  ```
- [ ] **Step 2: Удалить блок «Refunds after delivery»** (`terms.astro:30-31`) — теряет смысл.
- [ ] **Step 3: RU-блок (`terms.astro:50-65`)** — зеркальный перевод.
- [ ] **Step 4: FAQ «Full refund, one click»** на лендинге уже исправлен в A4-step-8. Свериться, что Terms и FAQ говорят одно и то же.
- [ ] **Step 5: Commit.**

```bash
git add preorder/src/pages/terms.astro
git commit -m "legal(terms): 30-day refund + clarify stripe/sentry as paid-plan, not preorder scope"
```

---

## Фаза B — Лендинг / Legal (1-2 дня, до открытого пуска)

### Task B1: Privacy — entity disclosure (controller identity для GDPR)

**Файлы:**
- Modify: `preorder/src/pages/privacy.astro:62-67,116-122`

**Why:** ни Privacy ни Terms не называют legal entity / адрес / governing law. About-копия упоминает Гдыню (`index.astro:1036`), но это маркетинг. Под GDPR Art. 13 контроллер обязан представиться. Для платного трафика из ЕС — критично.

- [ ] **Step 1: Решить юридическую форму.** Sole proprietor в Польше (JDG)? Sp. z o.o.? Estonian e-Residency OÜ? Это влияет на VAT, налоги, обязательства.
- [ ] **Step 2: Добавить блок в Privacy и Terms:**
  ```
  ## Who we are
  DevPinger is operated by [LEGAL NAME], [FORM, e.g. "a Polish sole
  proprietorship"], registered at [ADDRESS], [COUNTRY]. EU/UK GDPR
  controller: [LEGAL NAME]. Contact: info@devpinger.com.
  Governing law: [JURISDICTION].
  ```
- [ ] **Step 3: Добавить блок в Terms** — тот же entity disclosure плюс «Disputes resolved in courts of [JURISDICTION].»
- [ ] **Step 4: Дублировать в RU-блок.**
- [ ] **Step 5: Commit.**

```bash
git add preorder/src/pages/privacy.astro preorder/src/pages/terms.astro
git commit -m "legal: disclose controller entity and governing law for gdpr compliance"
```

---

### Task B2: Privacy — синхронизировать retention с реальным `plans.ts`

**Файлы:**
- Modify: `docs/PRIVACY.md:30-31` (внутренний docs)

**Why:** внутренний `docs/PRIVACY.md` говорит «events pruned 30 days», реально `packages/core/src/plans.ts` plan-driven: free=7d, pro/team=365d. Лендинг (`preorder/src/pages/privacy.astro:42`) уже корректен («depends on plan»). Внутренний docs нужно подровнять.

- [ ] **Step 1: Прочитать `packages/core/src/plans.ts`** и зафиксировать актуальные значения.
- [ ] **Step 2: Обновить `docs/PRIVACY.md:30-31`** строкой «Events retention is plan-driven: free=7 days, paid=365 days. Run /forget_event to delete sooner.»
- [ ] **Step 3: Commit.**

```bash
git add docs/PRIVACY.md
git commit -m "docs(privacy): plan-driven event retention, not the stale 30-day claim"
```

---

### Task B3: SECURITY.md — заполнить placeholder

**Файлы:**
- Modify: `SECURITY.md:5`

**Why:** `Email security@<your-domain>` — буквальный placeholder. Любой security-исследователь, увидев это, решит, что репо заброшено.

- [ ] **Step 1: Заменить на `info@devpinger.com`** (или завести `security@devpinger.com`, если есть alias).
- [ ] **Step 2: Commit.**

```bash
git add SECURITY.md
git commit -m "docs(security): replace placeholder contact with info@devpinger.com"
```

---

### Task B4: Footer «Status» — переименовать в «Bot» (или построить status-page)

**Файлы:**
- Modify: `preorder/src/layouts/Base.astro:213`
- Modify: `preorder/src/pages/index.astro:1084`

**Why:** «Status» ведёт на `t.me/dev_pinger_bot`. Платящему клиенту это в первую секунду читается как «есть status-page» и ломает доверие, когда он жмёт.

- [ ] **Step 1: Переименовать ссылку «Status» в «Bot».** Иконка остаётся та же, target тот же.
- [ ] **Step 2: Дублировать для RU.**
- [ ] **Step 3: Commit.**

```bash
git add preorder/src/layouts/Base.astro preorder/src/pages/index.astro
git commit -m "landing(footer): rename misleading 'Status' link to 'Bot'"
```

---

### Task B5: Manual smoke-tests (не код)

**Не файлы — действия вручную перед открытым трафиком:**

- [ ] **Step 1: Stripe Payment Link `eVq7sK1AOgdCctnejTfMA00`** — проверить в Stripe dashboard:
  - Live mode (не test).
  - Custom field «Telegram username» включён и required.
  - `success_url` ведёт на `https://preorder.devpinger.com/thank-you`.
  - `STRIPE_WEBHOOK_SECRET` в проде совпадает с signing secret этого Payment Link.
  - VAT/Tax включён (Stripe Tax) — Polish JDG имеет VAT-threshold обязательства.
- [ ] **Step 2: `twitter.com/devpinger`** — открыть залогиненным, убедиться что аккаунт существует и принадлежит тебе. Иначе убрать иконку в `index.astro:1047`.
- [ ] **Step 3: `github.com/Guck111/devpinger`** — открыть, проверить что README продаёт ту же историю что и лендинг (не противоречит). Уже HTTP 200 OK.
- [ ] **Step 4: OG-image** — `https://preorder.devpinger.com/og-image.png` открыть в браузере, проверить рендер. Аналогично `og-image-ru.png`.

---

## Фаза C — Security HIGH (1-2 дня после пуска)

### Task C1: Jira webhook secret из URL query → HTTP-header

**Файлы:**
- Modify: `apps/server/src/services/jira-webhooks.ts:42`
- Modify: `apps/server/src/routes/webhooks/jira.ts:14-21,53-100`
- Optional: `apps/server/src/logger.ts:11-25` (добавить `req.query.secret`, `req.url` в redact)

**Why:** `services/jira-webhooks.ts:42` шьёт `?secret=<value>` в URL, зарегистрированный у Atlassian. URL логируется в Caddy access-log, в Sentry breadcrumbs, в Pino `req.url`. Любой log-export → per-tenant Jira-секрет утекает. Роут (`routes/webhooks/jira.ts`) уже умеет принимать секрет в header `x-devping-webhook-secret` — нужно переключить регистрацию.

- [ ] **Step 1: Прочитать `services/jira-webhooks.ts:42`** — как именно строится URL.
- [ ] **Step 2: Переписать URL без секрета:** `${env.PUBLIC_BASE_URL}/webhooks/jira/${connectionId}`. Секрет передавать через Atlassian webhook config `Authorization` или custom header, если Dynamic Webhook API позволяет.
- [ ] **Step 3: Прочитать Atlassian Dynamic Webhook API docs** — поддерживает ли `headers` в config (или только `url`).
  - Если поддерживает — указать `x-devping-webhook-secret: <secret>` в headers конфигурации.
  - Если НЕ поддерживает — оставить в URL, но добавить `req.query.secret` и `req.url` в redact (`logger.ts:11-25`) и **отключить Caddy access-log для `/webhooks/jira/*`** (`infra/Caddyfile`).
- [ ] **Step 4: Скрипт миграции для уже зарегистрированных вебхуков** — пройти по `connections` где `provider="jira"`, перерегистрировать с новой схемой.
- [ ] **Step 5: Обновить тесты в `apps/server/test/integration/webhooks-jira-*.test.ts`.**
- [ ] **Step 6: Run tests, all pass.**
- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/services/jira-webhooks.ts apps/server/src/routes/webhooks/jira.ts apps/server/src/logger.ts apps/server/test/
git commit -m "security(jira): move webhook secret out of url query (use header) + redact"
```

---

### Task C2: Удалить мёртвый `GITHUB_WEBHOOK_SECRET_SEED`

**Файлы:**
- Modify: `packages/shared/src/env.ts:20` (удалить строку)
- Modify: `.env.example` (удалить строку)
- Modify: `infra/.env.prod.example` (удалить строку, если есть)
- Modify: `docs/SELF_HOSTING.md:64,155-157`
- Modify: `docs/LOCAL_SETUP.md:113,131`
- Modify: `docs/deploy/fly.md:89`
- Modify: `docs/deploy/hetzner.md:52`
- Modify: `infra/README.md:101`
- Modify: `apps/server/test/integration/global-setup.ts:27`

**Why:** env-переменная объявлена required `.min(32)`, но в runtime-коде не читается ни разу (grep чисто, secret реально генерится `randomBytes(32)` в `packages/sources/github/src/adapter.ts:180`). Self-hoster тратит время на генерацию и думает, что ротация что-то меняет — это false sense of security.

- [ ] **Step 1: Grep `GITHUB_WEBHOOK_SECRET_SEED` по всему репо**, убедиться, что нигде не читается (только декларируется/документируется).
- [ ] **Step 2: Удалить из env-схемы и `.env.example`.**
- [ ] **Step 3: Обновить все docs**, заменив параграфы «derive webhook secret from this seed» на «webhook secrets generated per-subscription via `randomBytes(32)`».
- [ ] **Step 4: Удалить из `apps/server/test/integration/global-setup.ts:27`.**
- [ ] **Step 5: `pnpm install && pnpm test`** — все должно остаться зелёным.
- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/env.ts .env.example infra/ docs/ apps/
git commit -m "chore: remove unused GITHUB_WEBHOOK_SECRET_SEED env (dead since per-sub secrets)"
```

---

### Task C3: Контейнеры под non-root user

**Файлы:**
- Modify: `apps/server/Dockerfile`
- Modify: `apps/worker/Dockerfile`
- Modify: `infra/Dockerfile`

**Why:** все три Dockerfile не имеют `USER` директивы — процесс под root. RCE в Node даёт root в контейнере, что упрощает container escape если хост mount'ит Docker socket.

- [ ] **Step 1: Прочитать существующие Dockerfile.**
- [ ] **Step 2: Добавить в финальный stage:**
  ```dockerfile
  RUN addgroup -S app && adduser -S -G app app
  RUN chown -R app:app /app
  USER app
  ```
- [ ] **Step 3: Локальная проверка:** `docker compose build && docker compose up` — приложение стартует, миграции проходят, health-чек 200.
- [ ] **Step 4: Commit.**

```bash
git add apps/server/Dockerfile apps/worker/Dockerfile infra/Dockerfile
git commit -m "security(docker): run server/worker as non-root user"
```

---

### Task C4: Sentry — фильтровать webhook payloads из ошибок

**Файлы:**
- Modify: `apps/server/src/sentry.ts`
- Modify: `apps/worker/src/sentry.ts`
- Modify: `packages/shared/src/redact.ts` (если общий redact)

**Why:** `captureError(err, { provider, stage })` в `services/ingest.ts:140` ловит ошибку из `verifyAndNormalize` и тянет за собой `err.message` со стэком, который может содержать webhook body / PII (issue titles, emails). Текущий `redact.ts` ловит только `ghp_*` и `Bearer …`. Это GDPR-экспозиция, не RCE.

- [ ] **Step 1: Добавить `beforeSend` хук в Sentry init** (`Sentry.init({ beforeSend: ... })`):
  ```ts
  beforeSend(event) {
    // strip request bodies and any field that looks like a webhook payload
    if (event.request) {
      delete event.request.data
      delete event.request.cookies
      delete event.request.query_string
    }
    if (event.extra) {
      delete event.extra.body
      delete event.extra.payload
      delete event.extra.rawBody
    }
    return event
  }
  ```
- [ ] **Step 2: Добавить `sendDefaultPii: false`** в `Sentry.init` (явно, не полагаться на дефолт).
- [ ] **Step 3: Локально вызвать `captureError(new Error("test"), { body: { secret: "x" } })`** и убедиться, что Sentry не получает `body`.
- [ ] **Step 4: Commit.**

```bash
git add apps/server/src/sentry.ts apps/worker/src/sentry.ts packages/shared/src/redact.ts
git commit -m "security(sentry): beforeSend strips request bodies and webhook payloads"
```

---

### Task C5: CORS — убрать `http://localhost:4321` из prod-default

**Файлы:**
- Modify: `packages/shared/src/env.ts:32-36`

**Why:** дефолт `LANDING_ALLOWED_ORIGINS` включает `http://localhost:4321`. Если оператор забудет переопределить — localhost в проде остаётся allowed origin.

- [ ] **Step 1: Изменить дефолт на prod-only: `"https://devpinger.com,https://www.devpinger.com,https://preorder.devpinger.com"`.**
- [ ] **Step 2: Локально dev**: запустить лендинг, убедиться, что `LANDING_ALLOWED_ORIGINS` в локальном `.env` явно переопределяет на `http://localhost:4321`.
- [ ] **Step 3: Commit.**

```bash
git add packages/shared/src/env.ts
git commit -m "security(cors): drop localhost from prod default origins"
```

---

### Task C6: Stripe webhook secret — runtime guard в prod

**Файлы:**
- Modify: `packages/shared/src/env.ts:40`
- Modify: `apps/server/src/server.ts` (или `apps/server/src/index.ts` — startup)

**Why:** Б2 в аудите. Сейчас webhook отдаёт 503 если секрет не выставлен — это нормально для dev, но в проде это silent miss. Ты подтвердил, что сейчас в проде работает; добавляем guard, чтобы в будущем deploy без переменной упал на старте, а не молча терял платежи.

- [ ] **Step 1: Добавить refine в zod-схему:**
  ```ts
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  ```
  заменить на проверку на старте в `loadServerEnv`:
  ```ts
  if (parsed.data.NODE_ENV === "production" && !parsed.data.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required in production")
  }
  ```
- [ ] **Step 2: Тест в `packages/shared/test/env.test.ts`** (если есть, иначе создать) — production без secret падает, dev без secret OK.
- [ ] **Step 3: Commit.**

```bash
git add packages/shared/src/env.ts packages/shared/test/
git commit -m "ops(env): fail-fast if STRIPE_WEBHOOK_SECRET missing in production"
```

---

## Фаза D — Docs / UX sync (можно после открытого пуска)

### Task D1: USER_GUIDE.md — снять V1.5 disclaimers, добавить GDPR-команды

**Файлы:**
- Modify: `docs/USER_GUIDE.md:12,26-34,51,73,79-80,97`

**Why:** документ говорит, что Jira transition / mute removal / notify_self / subscribing UI — «V1.5 stub». В реальности всё реализовано. Также отсутствуют `/unsubscribe`, `/export`, `/forget_event`, `/notify_self` — GDPR-команды.

- [ ] **Step 1: Удалить строку с `/sources`** — такой команды нет.
- [ ] **Step 2: Добавить раздел «Privacy commands»:** `/unsubscribe`, `/export`, `/forget_event <id>`, `/notify_self on|off`.
- [ ] **Step 3: Снять V1.5-disclaimer с Jira transition.** Описать flow: callback `act:trans:<eventId>` → keyboard со списком transitions → `jira:do-transition:<eventId>:<id>`.
- [ ] **Step 4: Снять V1.5 disclaimer с mute removal.** Описать `mute:rm:<id>` callback.
- [ ] **Step 5: Поправить keyboard description**: PR row — Approve, Comment, View diff, Snooze (4h, 1d), Mute, Open. **Нет 1h snooze для PR** (только для workflow failures).
- [ ] **Step 6: Поправить retention** — plan-driven, free 7 days.
- [ ] **Step 7: Commit.**

```bash
git add docs/USER_GUIDE.md
git commit -m "docs(user-guide): reconcile with shipped features + gdpr commands"
```

---

### Task D2: `setMyCommands` — добавить GDPR-команды в Telegram menu

**Файлы:**
- Modify: `apps/server/src/bot/commands-menu.ts:8-30`

**Why:** GDPR-команды (`/unsubscribe`, `/export`, `/forget_event`, `/notify_self`) реализованы, но не отображаются в Telegram-autocomplete. Пользователь, заявленно имеющий GDPR rights, не видит как ими воспользоваться.

- [ ] **Step 1: Прочитать `commands-menu.ts:8-30`.**
- [ ] **Step 2: Добавить в массив команд:**
  ```ts
  { command: "unsubscribe", description: "Delete all your data" },
  { command: "export", description: "Download a JSON of your data" },
  { command: "forget_event", description: "Delete one event by id" },
  { command: "notify_self", description: "Toggle self-action suppression" },
  ```
- [ ] **Step 3: Локально дёрнуть `setMyCommands`** через скрипт `pnpm tg:commands` (если есть), либо просто перезапустить бот.
- [ ] **Step 4: В Telegram проверить, что команды появились в menu.**
- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/bot/commands-menu.ts
git commit -m "feat(bot): surface gdpr commands in telegram autocomplete menu"
```

---

### Task D3: ARCHITECTURE.md + README — точное число воркер-очередей

**Файлы:**
- Modify: `docs/ARCHITECTURE.md:37`
- Modify: `README.md:48`

**Why:** оба говорят про 4 worker queues. Реально 5 (`apps/worker/src/index.ts:8` — плюс `jira-webhook-refresh`). Архитектурный документ должен совпадать с кодом.

- [ ] **Step 1: Добавить `jira-webhook-refresh`** в оба списка.
- [ ] **Step 2: Описать его роль:** «Refreshes Jira Dynamic Webhook TTL (30 days) before expiry.»
- [ ] **Step 3: Commit.**

```bash
git add docs/ARCHITECTURE.md README.md
git commit -m "docs(arch): list jira-webhook-refresh as the 5th worker queue"
```

---

### Task D4: Два prod docker-compose — выбрать один

**Файлы:**
- Delete или rename: `docker-compose.prod.yml` (корневой)
- Modify: `infra/deploy.sh` (добавить migrate-шаг)
- Modify: `docs/SELF_HOSTING.md`, `docs/deploy/hetzner.md` (ссылаться на одну версию)

**Why:** в репо два разных `docker-compose.prod.yml` — корневой (с локальным Postgres + `migrate` one-shot) и `infra/docker-compose.prod.yml` (Supabase, без migrate). Self-hoster читает корневой, реальная инфра использует `infra/`. Хуже — `infra/deploy.sh` **не запускает миграции**, следующее изменение схемы упадёт на проде молча.

- [ ] **Step 1: Решить — оставляем корневой как «for self-hosters» или удаляем?**
  - Опция А: корневой = демо для self-hosters (с локальным Postgres). `infra/` = твоя реальная Hetzner-инфра. Тогда задокументировать это явно в `infra/README.md` и `SELF_HOSTING.md`.
  - Опция Б: удалить корневой, оставить только `infra/`. SELF_HOSTING.md переписать под этот compose.
- [ ] **Step 2: Добавить migrate-шаг в `infra/deploy.sh`** (10 строк):
  ```bash
  docker compose -f docker-compose.prod.yml run --rm server pnpm --filter @devpinger/db migrate
  docker compose -f docker-compose.prod.yml up -d
  ```
- [ ] **Step 3: Обновить docs.**
- [ ] **Step 4: Commit.**

```bash
git add infra/ docs/ docker-compose.prod.yml  # или git rm
git commit -m "ops: single prod compose strategy + auto-migrate on deploy"
```

---

## Фаза E — Code quality (низкий приоритет)

### Task E1: Локализовать 2 хардкоженные английские строки

**Файлы:**
- Modify: `apps/server/src/bot/status.ts:83`
- Modify: `apps/server/src/bot/account.ts:32`
- Modify: `packages/i18n/src/messages/{en,ru}/bot.json`

- [ ] **Step 1: Добавить ключи `status.unavailable` и `account.no_user`** в оба JSON.
- [ ] **Step 2: Заменить хардкод на `ctx.t("status.unavailable")` и `ctx.t("account.no_user")`.**
- [ ] **Step 3: Commit.**

```bash
git add apps/server/src/bot/status.ts apps/server/src/bot/account.ts packages/i18n/
git commit -m "i18n(bot): replace 2 hardcoded english strings"
```

---

### Task E2: `services/ingest.ts:172` — добавить `logger.warn` в swallowed catch

**Файлы:**
- Modify: `apps/server/src/services/ingest.ts:170-172`

**Why:** `.catch(() => undefined)` маскирует DB-флоп как «user has no telegramChatId».

- [ ] **Step 1: Заменить на:**
  ```ts
  const userRow = await db.query.users
    .findFirst({ where: (u, { eq }) => eq(u.id, match.userId) })
    .catch((err) => {
      logger.warn({ err, userId: match.userId }, "failed to fetch user row during ingest")
      return undefined
    })
  ```
- [ ] **Step 2: Commit.**

```bash
git add apps/server/src/services/ingest.ts
git commit -m "obs(ingest): log swallowed db error when fetching user row"
```

---

### Task E3: `/unsubscribe` — вызывать `disconnectProvider` чтобы снять webhooks у GitHub/Jira

**Файлы:**
- Modify: `apps/server/src/bot/account.ts:29-58`

**Why:** сейчас `account:delete:confirm` удаляет user-row, FK cascade выносит local rows, но GitHub/Jira webhooks остаются висеть у пользователя на стороне провайдеров. Не GDPR-нарушение (мы данные не получаем — sub'а нет), но грязный side-effect, видимый платящему клиенту в их GitHub settings.

- [ ] **Step 1: Прочитать `apps/server/src/services/connections.ts:144-186`** (`disconnectProvider`).
- [ ] **Step 2: Перед `db.delete(usersTable)` в `account.ts`** — пройти по `connections` юзера и вызвать `disconnectProvider(db, user.id, "github")` и `(.., "jira")` (если такие connections существуют).
- [ ] **Step 3: Обернуть в `try/catch`** — если provider API недоступен, пусть user-row всё равно удалится; залогать `logger.warn`.
- [ ] **Step 4: Тест: интеграционный сценарий /unsubscribe должен вызвать GitHub `DELETE /repos/.../hooks/{id}` и Jira `DELETE /webhook/{id}`** (через nock в `apps/server/test/integration/unsubscribe.test.ts`).
- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/bot/account.ts apps/server/test/
git commit -m "feat(account): /unsubscribe also revokes github/jira webhooks server-side"
```

---

### Task E4: Удалить мёртвый `plan-gate.ts` singleton

**Файлы:**
- Modify or delete: `apps/server/src/services/plan-gate.ts`

**Why:** `setPlanGate`/`planGate()` singleton — ноль вызовов. Plan-gate реально пробрасывается через `createApp({ planGate })` в `server.ts:36`. Singleton — scaffolding из public-vs-private split, который не используется.

- [ ] **Step 1: Grep `setPlanGate|planGate\(\)` — убедиться, что только в самом файле.**
- [ ] **Step 2: Удалить singleton, оставить только type `PlanGate` и `noopPlanGate`** (они нужны для DI через `createApp`).
- [ ] **Step 3: `pnpm typecheck && pnpm test`.**
- [ ] **Step 4: Commit.**

```bash
git add apps/server/src/services/plan-gate.ts
git commit -m "chore: drop unused plan-gate singleton (DI-only now)"
```

---

## Self-Review

**Покрытие issues из аудита:**
- Б3 drizzle CVE → A1 ✓
- Б4 GitHub O(N) → A2 ✓
- Б5 ROADMAP противоречит коду → A3 ✓
- Б1 (user accepted: убрать обещание) → A5 ✓
- Б2 (user verified: works in prod) → C6 (defensive guard) ✓
- Stripe → paid-only positioning → A4 + A6 ✓
- Jira webhook secret в URL → C1 ✓
- GITHUB_WEBHOOK_SECRET_SEED dead → C2 ✓
- Containers root → C3 ✓
- Sentry payload exposure → C4 ✓
- CORS localhost prod → C5 ✓
- USER_GUIDE V1.5 stubs → D1 ✓
- setMyCommands missing GDPR → D2 ✓
- ARCHITECTURE worker count → D3 ✓
- Two prod composes → D4 ✓
- Privacy entity disclosure → B1 ✓
- Privacy retention drift → B2 ✓
- SECURITY.md placeholder → B3 ✓
- Footer Status → B4 ✓
- Stripe Payment Link / Twitter / OG manual checks → B5 ✓
- Hardcoded english strings → E1 ✓
- ingest.ts:172 silent catch → E2 ✓
- /unsubscribe orphan webhooks → E3 ✓
- plan-gate dead code → E4 ✓

**Что осознанно НЕ включено:**
- L2 `paidAt = parsed.data.created * 1000` — minor, низкий impact.
- L3 OAuth code в error log — fix небольшой, добавить в C4 при желании.
- L4 callback rate-limit per-user — fix есть смысл сделать, но не блокер.
- M5/M6 key versioning / URL_SIGNING_KEY split — нужно при первой ротации ключа, не сейчас.

---

## Execution Handoff

План сохранён в `docs/superpowers/plans/2026-05-17-pre-launch-fixes.md`.

**Два варианта исполнения:**

1. **Subagent-Driven (рекомендую для Phase A блокеров)** — свежий subagent на каждую задачу A1-A6, ревью между задачами. Идеально для критичных правок где нужен независимый верификатор.

2. **Inline Execution (для Phase B/C/D/E)** — пачкой в одной сессии с чекпоинтами. Меньше overhead для лендинг-копирайтинга и docs sync.

Какой подход — или начать с Phase A subagent-driven, а остальное inline?
