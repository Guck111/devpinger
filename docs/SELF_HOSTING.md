# Self-hosting

DevPinger is a managed product first — the easiest path is to use
`@devpinger_bot`. If you'd rather run your own instance (privacy, air-gap,
custom domain), this page covers production deployment.

For development setup on a laptop, see [LOCAL_SETUP.md](LOCAL_SETUP.md).

## What you need

- A Linux VPS or container host (Hetzner, Fly.io, Railway, your kubernetes
  cluster, etc.)
- A public domain pointing at your host
- Postgres 16 + Redis 7 (managed services are fine: Supabase, Neon,
  Upstash, etc.)
- A Telegram bot of your own (via `@BotFather`)
- GitHub OAuth App + Atlassian OAuth App, with callback URLs pointing
  at your domain

## Provisioning the bot

In Telegram, talk to `@BotFather`:

```
/newbot
<bot name>
<username ending in _bot>
```

Save the token. The username (without `@`) goes into
`TELEGRAM_BOT_USERNAME`.

## Provisioning OAuth apps

Same as [LOCAL_SETUP.md](LOCAL_SETUP.md) sections **3** and **4**, except
the callback URLs point at your production domain instead of the
Cloudflare Tunnel:

- GitHub: `https://<your-domain>/oauth/github/callback`
- Jira: `https://<your-domain>/oauth/jira/callback`

## Environment

Copy `.env.example` and fill in:

```bash
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
PUBLIC_BASE_URL=https://<your-domain>

DATABASE_URL=postgres://...
REDIS_URL=redis://...

TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>

ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
GITHUB_OAUTH_REDIRECT_URI=https://<your-domain>/oauth/github/callback
GITHUB_WEBHOOK_SECRET_SEED=<openssl rand -hex 32>

JIRA_OAUTH_CLIENT_ID=...
JIRA_OAUTH_CLIENT_SECRET=...
JIRA_OAUTH_REDIRECT_URI=https://<your-domain>/oauth/jira/callback

SENTRY_DSN=https://...@sentry.io/...   # optional
```

`ENCRYPTION_KEY` is what wraps OAuth tokens at rest. **Rotating it
without re-running the OAuth flow will break every connection.** Treat
it like a database password — back it up out-of-band, and don't generate
a new one on every deploy.

## Deploy

The simplest setup runs server + worker in two containers and a
PostgreSQL + Redis pair next to them. The repo doesn't ship a
production `docker-compose` (each provider has its own conventions),
but the moving parts are:

```
server  →  build with `pnpm build` in apps/server, run `node dist/index.js`
worker  →  build with `pnpm build` in apps/worker, run `node dist/index.js`
```

In production, `NODE_ENV=production` makes the server register a
Telegram webhook at startup (`POST /telegram/webhook`) instead of
long-polling. Make sure your reverse proxy forwards that path with
the body intact.

## Running migrations

The schema lives in `packages/db/drizzle/`. Run once before first boot
and on every deploy that includes new SQL:

```bash
pnpm db:migrate
```

In CI / a deploy step, set `DATABASE_URL` and run the same command. The
migration runner is idempotent — re-running on an up-to-date DB is a
no-op.

## Backups

Postgres holds users, connections (encrypted OAuth tokens), event
history, and mute rules. Daily `pg_dump` → S3 is enough for most
deployments. The encryption key is required to decrypt the
connections; back it up separately so a DB-only leak doesn't expose
tokens.

## Webhook secrets

Each GitHub repo subscription gets its own webhook secret derived
inside the adapter (see
[setupRepoWebhook](../packages/sources/github/src/subscriptions.ts)).
The seed in `GITHUB_WEBHOOK_SECRET_SEED` is server-side only — rotating
it invalidates existing subscriptions and requires re-running the
"add repo" flow per user.

## Monitoring

`/health` and `/ready` return 200 when the server is up. They don't
probe the DB or Redis — wire those into your own dashboard if you
want deep checks.

If `SENTRY_DSN` is set, the server captures unhandled errors there
(redacted with `@devpinger/shared` to strip secret-looking strings
from messages and stack traces).
