# Security

## Reporting

Email `info@devpinger.com` with details. We'll acknowledge within
72 hours and coordinate a fix before public disclosure.

## Threat model

DevPinger handles two sensitive shapes:

1. **OAuth tokens** — GitHub and Atlassian access / refresh tokens
   that can read source code, modify issues, and submit reviews.
2. **Event metadata** — issue titles, PR descriptions, comment
   previews. These can include internal product information.

The bot does *not* store full webhook payloads, source code, or AI
prompts. Body previews are truncated to ~240 plain-text characters
before persistence.

## At rest

- OAuth tokens (`connections.encrypted_credentials`) are AES-256-GCM
  encrypted with `ENCRYPTION_KEY` via [@devpinger/crypto](packages/crypto/src/index.ts).
  Each row uses a random 96-bit IV; the auth tag prevents tampering.
- The encryption key must be 64 hex characters (32 bytes). The env
  schema refuses anything else.
- Postgres is otherwise in plaintext. Encrypt the disk and back up to
  encrypted storage if the deployment requires it.

## In flight

- All inbound webhooks are verified before any state change.
  - **GitHub**: `X-Hub-Signature-256` HMAC matched against the
    per-subscription secret stored in `subscriptions.webhook_secret`.
    All subscriptions are tried until one matches (constant-time
    compare) so a single shared endpoint can multiplex many users.
  - **Jira**: the connection id in the path
    (`/webhooks/jira/:id`) selects the user; the per-tenant secret
    travels in `?secret=…` (Atlassian Dynamic Webhooks won't let us
    set request headers) and is compared constant-time against
    `connections.encrypted_credentials.jiraWebhook.secret`. A legacy
    subscription-id path with `subscriptions.webhook_secret` is still
    accepted to migrate older registrations.
  - **Stripe**: `Stripe-Signature` parsed manually
    (`services/stripe-signature.ts`) — `t=…,v1=…` HMAC-SHA256 with
    a 5-minute tolerance, timing-safe compare. Replay protection by
    `UNIQUE(preorders.stripe_event_id)`.
- The Telegram webhook is gated by `secret_token` — Grammy returns
  401 if the secret doesn't match.
- OAuth state tokens live in the `oauth_states` table for max
  10 minutes; the cleanup worker sweeps the table every 5.
- HTTPS everywhere in production. The reverse proxy should enforce it.

## In logs

- Pino + Sentry redaction strips secret-shaped strings before they
  leave the process. The redact patterns (`packages/shared/src/redact.ts`)
  cover GitHub tokens (`gh*_…`), generic `Bearer <token>` headers, and
  the value of `?secret=…` in Jira webhook URLs (the key prefix is
  preserved so log lines still tell us which route was hit).
- `maskEmail` (same module) is applied at every site that logs an
  email — landing subscribe, Stripe webhook — so logs are auditable
  without dumping raw PII to stdout.
- Sentry's Fastify integration has its request body, cookies, and
  raw query string scrubbed before the event leaves the process
  (`apps/server/src/sentry.ts`), and `sendDefaultPii: false` is on.
- We never log raw OAuth tokens, raw webhook bodies, or full
  Telegram update payloads.

## What we don't defend against

- A compromised database server with both DB access and the encryption
  key. Key custody is your responsibility.
- A malicious admin of a Telegram group that ends up in someone's
  routes. V1 is single-user only; multi-chat / team routing ships in
  V2 with explicit ACL.
- A user revoking GitHub access without disconnecting in the bot —
  actions on revoked tokens will 401. Re-OAuth from `/start` fixes it.

## Dependency hygiene

- Lockfile is committed (`pnpm-lock.yaml`). CI uses
  `pnpm install --frozen-lockfile`.
- Drizzle-kit verifies that migration files in `packages/db/drizzle/`
  match the live schema. Drift fails the build.
- `pnpm audit` is run on schedule; high-severity advisories with
  patches available block merges.
