# Architecture

DevPinger V1 is a managed multi-user Telegram bot. Events flow inbound
through webhooks, get normalised, mute-filtered, persisted, and delivered
to the user's personal chat. Inline button taps reverse-flow back through
source actions.

```
┌────────────┐  webhook   ┌────────────┐
│  GitHub /  │ ─────────▶ │  Fastify   │
│  Jira      │            │   server   │
└────────────┘            └─────┬──────┘
                                │ ingest pipeline:
                                │   adapter.verifyAndNormalize
                                │   self-suppression
                                │   evaluateMutes
                                │   persistEvent
                                │   enqueue 'deliver'
                                ▼
                         ┌────────────┐
                         │  BullMQ    │  notifications worker
                         │  (Redis)   │ ─────────────▶ Telegram bot.api.sendMessage
                         └─────┬──────┘                        │
                               │ snooze wake re-enqueue        │ user taps button
                               │ retention cleanup             ▼
                               │ oauth-state sweep      ┌────────────┐
                               └───────────────────────▶│   bot      │
                                                        │  actions   │ ──▶ adapter.actions.*
                                                        └────────────┘
```

## Two processes

| Process | Purpose | File |
| --- | --- | --- |
| `apps/server` | Fastify HTTP + grammy Telegram bot | [src/index.ts](../apps/server/src/index.ts) |
| `apps/worker` | BullMQ queues: notifications, snooze, cleanup, oauth-state-cleanup, jira-webhook-refresh | [src/index.ts](../apps/worker/src/index.ts) |

The server handles inbound webhooks, OAuth callbacks, and the Telegram
bot (long-polling in dev, webhook in prod). The worker drains the
BullMQ queues the server pushes to. Both share `@devpinger/db` and
`@devpinger/core` so the schema and types stay in sync.

## The ingest pipeline

When a webhook arrives at `/webhooks/github` or `/webhooks/jira/:id`,
the server's [services/ingest.ts](../apps/server/src/services/ingest.ts)
runs this pipeline:

1. **Verify + normalize** through the adapter
   (`sourceRegistry.require("github").verifyAndNormalize(...)`). The
   adapter checks the signature (GitHub HMAC `X-Hub-Signature-256`
   against each active `subscriptions.webhook_secret` until one
   matches; Jira `?secret=…` constant-time-compared against
   `connections.encrypted_credentials.jiraWebhook.secret`, with the
   legacy `subscriptions.webhook_secret` flow still accepted) and
   returns `NormalizedEvent[]`.
2. **Look up the user** through the same lookup callback so we know
   `userId`, `subscriptionId`, and the connected `viewerUsername`
   (for self-mention detection).
3. **Self-suppress** events the user themselves triggered, unless
   they've opted into `notify_self_actions`.
4. **Apply mutes** via `evaluateMutes(db, userId, event)` —
   scope = `source | repo | project | event_type`, first match wins.
5. **Persist** the event with idempotency on
   `(user_id, source, source_event_id)`. Same delivery retrying twice
   doesn't create two rows.
6. **Enqueue** a `deliver` job in the `notifications` queue, unless
   the event was muted (then mark `status='muted'` and stop).

The notifications worker dequeues, reconstructs `NormalizedEvent` from
the persisted row, and hands it to the destination adapter
(`destinationRegistry.require("telegram").deliver(...)`). On success
the event row gets `status='delivered'` + `telegram_message_id`.

## Bot actions reverse-flow

Inline button taps come back to the bot as callback queries. The bot
loads the persisted event, validates ownership against the Telegram
user, then dispatches through the adapter's `actions` map:

```ts
await adapter.actions.approve(credentials, { scope: "owner/repo", number: 42 })
```

`actions` are the same map the adapter exports in source.ts. New
provider actions show up automatically in the bot.

### Inline-keyboard / callback_data constraints

Telegram enforces several hard limits on inline keyboards that bite
silently — a single bad button kills the whole `sendMessage` call with
`400 Bad Request: BUTTON_DATA_INVALID`, the bot crashes inside the
callback handler, and from the user side every button looks dead.
Keep these in mind whenever you add or change a callback:

- **`callback_data` ≤ 64 bytes (UTF-8).** Not 64 chars — 64 bytes after
  encoding. Plan the prefix carefully: a 36-byte UUID leaves only 28
  bytes for the rest. If the handler needs an event/issue id longer
  than what fits, **do not encode it in `callback_data`** — look it up
  in DB by user context or stash it in Redis with a short key.
- **Separator collisions.** We use `:` to split callback segments
  (`act:approve:<eventId>`, `hub:conn:disconnect:github`). Jira event
  types contain colons themselves (`jira:issue_created`), so any
  callback that puts a Jira type in the middle of a `:`-split string
  will mis-parse. Use `:` only as the outer segment separator; if a
  segment can contain `:`, put it last so the regex can consume the
  rest with `(.+)$`.
- **Button label ≤ 64 chars.** Long labels truncate silently in
  Telegram clients.
- **Don't pre-bake state that has a short TTL.** OAuth start links are
  generated only on tap (`hub:conn:connect:<provider>` callback) so
  the signed link with its 5-minute TTL is minted fresh; embedding it
  at render time exposes a stale link in chat history.

When adding a new callback: write down the longest legitimate payload
on paper, byte-count it (including all variable substitutions), and
keep it under 64. The `format.ts` and `actions.ts` files have working
patterns to copy.

## Multi-user webhook routing

GitHub delivers all webhooks to one endpoint
(`/webhooks/github`). For each request, the server iterates active
GitHub subscriptions and runs HMAC against each `webhook_secret` until
one matches. This is O(N) per request; at 10k users it's still
sub-millisecond, and migrating to GitHub App tokens (per-installation
auth, no iteration) is the V2 plan.

Jira webhooks include an identifier in the path
(`/webhooks/jira/:id`), so routing is O(1). The `:id` is the connection
id in the current Dynamic-Webhook model, with a legacy fallback to
subscription id for older subscriptions; auth is the per-tenant secret
delivered alongside the request (constant-time compared to
`connections.encrypted_credentials.jiraWebhook.secret`).

A separate worker (`jira-webhook-refresh`) renews Atlassian Dynamic
Webhooks before their 30-day TTL expires, so a connected user never
loses delivery without explicit action.

## OAuth and credential storage

OAuth flows start with a signed deep link from the bot (`signTg` →
`/oauth/<provider>/start?sig=...`) so the server knows which Telegram
user initiated the flow. The provider redirects back to
`/oauth/<provider>/callback`, the server exchanges code for tokens, and
stores them in `connections.encrypted_credentials` — a single JSON blob
encrypted with AES-256-GCM via `@devpinger/crypto` (`ENCRYPTION_KEY`,
64 hex chars in env).

`oauth_states` is the CSRF table: short-lived rows tied to a userId,
swept every 5 minutes by the `oauth-state-cleanup` worker (TTL is
10 minutes).

## Extension points (for the private V2 repo)

Everything below is V1 code that V2 / V3 extend without forking:

- `createApp({ extensions })` in `apps/server/src/server.ts` accepts
  `registerRoutes`, `planGate`, `sources`, `destinations`
- `sourceRegistry` / `destinationRegistry` ([registries.ts](../apps/server/src/registries.ts))
  are open for `register()` from extensions
- `PlanGate` interface in `@devpinger/core` — V1 ships `noopPlanGate`,
  V2 ships `stripePlanGate`
- Bot commands extend through the same `Bot` instance — register
  more `bot.command(...)` and `bot.callbackQuery(...)` from V2
- BullMQ queues are addressable by name — V2 adds `digest` /
  `email-digest-failure` etc. without touching the V1 worker
- Migrations are additive: V2 adds `0001_billing.sql` on top of V1's
  existing migrations. V1 already ships `preorders` and
  `landing_subscribers` (preorder smoke-test); V2's recurring-billing
  tables (`subscriptions`, `invoices`, etc.) live in the private repo
- Env-schema can be merged via `envSchema.merge(z.object({...}))`
  in the private process entry point

The full plan lives in [ROADMAP.md](ROADMAP.md).
