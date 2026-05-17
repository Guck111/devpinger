# Roadmap

DevPinger's plan is to ship a focused V1 today, layer a private "Cloud"
edition on top for paid features, and broaden the source / destination
catalog over time. Everything that touches money lives in a separate
private repo; this public repo stays MIT.

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
  `noopPlanGate` — V1 ships with no paywall

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
etc. on top of V1's `0000_initial.sql`. The public schema never carries
Stripe columns.

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
- I18n: `createTranslator(extraMessages?)` accepts additional keys

## What never lands in V1

To keep the licensing line crisp, the public repo stays free of any of
the following — even as stubs:

- Stripe imports or env variables
- `stripe_*` columns or tables
- `/billing/*` routes
- AI client code or `ANTHROPIC_API_KEY`
- Email transports or addresses
- Team / workspace tables

If a feature touches money or revenue, it ships in the private repo.
