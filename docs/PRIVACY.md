# Privacy

DevPinger is built so you stay in control of your data. This page explains what
the managed bot (`@devpinger_bot`) stores, why, and how to remove it. If you
self-host, you control everything yourself — see
[SELF_HOSTING.md](SELF_HOSTING.md).

## What's stored

| Data | Why | Where |
| --- | --- | --- |
| Your Telegram user ID, chat ID, username, language | Routing notifications to your chat, localized UI | Postgres `users` |
| OAuth access/refresh tokens for GitHub and Jira (AES-256-GCM encrypted at rest) | Posting actions (approve, comment, transition) on your behalf, polling provider APIs | Postgres `connections.encrypted_credentials` |
| Repository / project subscriptions and webhook secrets | Mapping incoming webhooks back to your account | Postgres `subscriptions` |
| Normalized event records (PRs, issues, comments, releases — title, body preview, URL, actor) | Showing `/recent`, `/stats`, restoring a deleted message via deep-link | Postgres `events` |
| Mute rules | Filtering future events | Postgres `mutes` |
| Pending action state (e.g. comment-in-progress) | Multi-step interactions inside Telegram | Redis, 5 minute TTL |
| Sentry crash reports (only if the operator enabled it) | Diagnosing bugs | Sentry, redacted via `@devpinger/shared` |

What's **never** stored:

- Your Telegram message contents, beyond comments you explicitly type as part of
  a `/comment` flow (those are sent straight to GitHub/Jira and not retained in
  DevPinger).
- Your private repo source code.
- Your password to any service.

## How long it's kept

- **Events** older than 30 days are automatically pruned by the cleanup worker
  (`apps/worker/src/queues/cleanup.ts`).
- **OAuth state rows** older than 10 minutes are pruned by the OAuth-state
  cleanup worker.
- **Everything else** stays as long as your account exists.

## How to remove your data

### Delete the whole account

In Telegram: `/unsubscribe` → confirm. This deletes your `users` row, which
cascades to `connections`, `subscriptions`, `events`, `mutes`, and
`oauth_states`. Webhooks DevPinger created on your GitHub repos remain on
GitHub — go to each repo's *Settings → Webhooks* and remove them, or revoke the
OAuth grant under *Settings → Applications*.

### Download a copy

`/export` sends you a `devpinger-export-…json` file with your profile,
connections (metadata only — tokens are **not** included), subscriptions, mute
rules, and up to the last 1000 events.

### Forget a single event

`/forget_event <event-id>` removes a single event from your history. Get the id
from `/export` or from the callback buttons (`act:approve:<id>`).

### Revoke OAuth manually

You can also revoke DevPinger's access from the provider:

- GitHub → *Settings → Applications → Authorized OAuth Apps*.
- Atlassian → *Account Settings → Connected apps → DevPinger*.

After revocation, future webhook → action flows will fail until you reconnect
via `/start`.

## Encryption details

OAuth tokens are encrypted with AES-256-GCM (12-byte IV, 16-byte tag) using
the server's `ENCRYPTION_KEY` (64 hex characters / 32 bytes). The key is **not**
stored in the database — it lives only in the server's environment. A
database-only leak does not expose tokens.

## Sub-processors (managed bot only)

If you use `@devpinger_bot` (the hosted instance), the operator's privacy
addendum lists current sub-processors. For self-hosted installs the only
sub-processors are the ones you wire up yourself (your VPS, your Sentry, etc.).

## Contact

Questions or takedown requests for the managed bot: see the project's
[SECURITY.md](../SECURITY.md) for the security contact, or open an issue at
https://github.com/Guck111/devpinger.
