# Roadmap

DevPinger ships a focused V1 today and layers a private "Cloud" edition
on top for paid Pro features. This public repo is MIT and contains the
full GitHub + Jira product plus the preorder/landing infrastructure
needed to run the public smoke-test. Pro-tier billing enforcement
(subscriptions, plan-gating, `/billing` UI) lives in a separate private
repo and imports `@devpinger/*` from here.

## V1 (this repo) — shipped

- GitHub OAuth source (PRs, reviews, comments, issues, releases, CI)
- Jira Cloud OAuth source (issues, comments, transitions, worklogs)
- Telegram destination (managed `@dev_pinger_bot`)
- Inline actions: approve, request changes, comment, reply, merge,
  close, reopen, assign, transition
- Filtering: mute by source / repo / project / event type, plus
  self-suppression of the user's own actions
- Snooze (1h / 4h / 1d), recent events, stats
- Plans schema (`free` / `personal` / `pro` / `team`) with
  `noopPlanGate` — V1 ships with no Pro-tier enforcement
- **Preorder landing infrastructure** — `preorders` table, Stripe
  webhook for `checkout.session.completed` events from the
  $9 lifetime Payment Link, `landing_subscribers` table for
  email signups, public landing endpoints (`/v1/landing/*`,
  `/v1/stripe/webhook`). Used to validate demand before V2.

## V1.5 — Microsoft Teams source

Teams is intentionally deferred from V1 because Application permissions
need tenant admin consent (doesn't work in a multi-tenant SaaS), and
Delegated permissions via OAuth add 50–70% complexity to a V1 scope.
Lands as the next source adapter once V1 stabilises.

## V2 (private `devpinger-cloud` repo)

Adds the paid layer without forking V1. Imports `@devpinger/*` from
this repo and extends it through the existing extension points:

- **Stripe billing** — checkout, webhooks, `stripePlanGate` enforcing
  `PLAN_LIMITS`; `/upgrade` and `/billing` bot commands
- **AI digests** — daily / weekly summaries (Anthropic), `@devpinger/ai`
  package
- **Email destination** — verified address, daily digest delivery
- **Web destination** — inbox UI hosted at app.devpinger.com
- **Additional sources** — GitLab, Sentry, Linear

Migrations are additive: V2 adds `0001_billing.sql`, `0002_digest.sql`,
etc. on top of V1's existing migrations. V2 schema additions
(subscriptions, invoices, plan-enforcement state) live in the private
repo's migration set — the public `preorders` table records only one-time
preorder receipts and is independent from V2 recurring billing.

## V3 (private repo continued)

- **Team workspaces** — shared dashboards, seat management, admin
  controls (Team plan, $39/mo)
- **BYOK** — bring your own Anthropic key for AI digests
- **More sources** — Bitbucket, PagerDuty, Stripe-as-source, npm /
  PyPI / Docker Hub release tracking
- **WhatsApp destination**

## Extension points (V1 surface)

Anything below is implemented in V1 and is the contract V2/V3 builds on.
Forking V1 is never required:

- `createApp({ extensions })` in `apps/server/src/server.ts` accepts
  `registerRoutes`, `planGate`, `sources`, `destinations`
- `sourceRegistry` / `destinationRegistry` in
  `apps/server/src/registries.ts` are open for `register()`
- `PlanGate` interface in `@devpinger/core` — public ships
  `noopPlanGate`, private ships `stripePlanGate`
- Env-schema merge: `envSchema.merge(z.object({...}))` for private
  env vars
- Bot commands extend through the same `Bot` instance — private
  registers `/upgrade`, `/billing`, etc. after `createApp` returns
- I18n: `createTranslator(messages)` takes a flat dictionary; the
  private repo composes V1 keys with its own via plain object spread
  before passing them in

## What lives where

**Public (this repo, MIT):**
- Full GitHub + Jira product (ingest, actions, notifications, GDPR)
- Plan-schema scaffolding with `noopPlanGate` (no Pro enforcement)
- Preorder landing surface: `preorders` table, `STRIPE_WEBHOOK_SECRET`
  env, `/v1/stripe/webhook` for `checkout.session.completed`, the
  `/v1/landing/*` endpoints. These exist so the public managed deploy
  can accept one-time $9 lifetime preorders.

**Private (`devpinger-cloud` repo, closed):**
- Recurring Stripe billing — customers, subscriptions, invoices,
  webhook handlers for `invoice.*` / `customer.subscription.*`
- `stripePlanGate` that enforces `PLAN_LIMITS` (replaces `noopPlanGate`)
- `/billing/*` HTTP routes and `/upgrade` / `/billing` bot commands
- AI digest code (`@devpinger/ai`, `ANTHROPIC_API_KEY`)
- Email transports for digests and password-reset-style flows
- Team / workspace tables (Team plan, $39/mo)

The line: one-time preorder logic is public because it's the smoke
test for a managed service. Recurring billing and Pro-tier enforcement
ship private.
