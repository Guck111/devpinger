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

The repo ships `docker-compose.prod.yml` which brings up postgres,
redis, server, and worker in one command. After filling `.env`:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

A one-shot `migrate` service runs `pnpm --filter @devpinger/db migrate`
before `server`/`worker` start, so the schema is always in sync.

Provider-specific walkthroughs:

- [Hetzner / generic VPS](deploy/hetzner.md) — Docker Compose + Caddy or
  Cloudflare Tunnel for HTTPS.
- [Fly.io](deploy/fly.md) — two Fly Machines (server + worker), managed
  Postgres, Upstash Redis.
- [Railway](deploy/railway.md) — managed Postgres + Redis + per-service
  Dockerfile deploys.

Both Dockerfiles use multi-stage builds (deps → runtime) and run as
`node:22-alpine` with `tini` as PID 1, so signals propagate cleanly and
in-flight webhooks finish before exit.

In production, `NODE_ENV=production` makes the server register a
Telegram webhook at startup (`POST /telegram/webhook`) instead of
long-polling. Make sure your reverse proxy forwards that path with
the body intact.

### Graceful shutdown

`SIGTERM` triggers an orderly shutdown:

- **server** — `bot.stop()`, then close Fastify (drains in-flight HTTP).
  Force-exit after 10s if anything hangs.
- **worker** — close every BullMQ worker (waits for the current job to
  finish), then queue schedulers and Redis. Force-exit after 30s.

Rolling deploys (`docker compose up -d --build`, Fly's rolling strategy,
Railway's auto-rollover) are safe — no webhook deliveries or
notification jobs are dropped.

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
history, and mute rules. Use `infra/backup-postgres.sh` for nightly
`pg_dump -Fc` dumps with 30-day retention; `infra/restore-postgres.sh`
restores from one. Cron snippet:

```sh
0 3 * * * /opt/devpinger/infra/backup-postgres.sh >> /var/log/devpinger-backup.log 2>&1
```

The encryption key is required to decrypt the connections; back it up
separately so a DB-only leak doesn't expose tokens, and so a host loss
doesn't leave the database undecryptable. Test restore at least once on
a throwaway compose stack — an untested backup is a wish, not a backup.

## Webhook secrets

Each GitHub repo subscription gets its own webhook secret derived
inside the adapter (see
[setupRepoWebhook](../packages/sources/github/src/subscriptions.ts)).
The seed in `GITHUB_WEBHOOK_SECRET_SEED` is server-side only — rotating
it invalidates existing subscriptions and requires re-running the
"add repo" flow per user.

## Monitoring

`/health` and `/ready` actively probe both Postgres (`SELECT 1`) and
Redis (`PING`) with a 1s timeout each. Response shape:

```json
{ "status": "ok", "db": "ok", "redis": "ok", "ts": "2026-05-15T…" }
```

On failure the endpoint returns HTTP 503 with `status: "degraded"` and
the failing component flagged as `"fail"`. Wire either path into your
Kubernetes liveness/readiness probes, uptime monitor (BetterStack,
Healthchecks.io), or load balancer.

If `SENTRY_DSN` is set, the server captures unhandled errors there
(redacted with `@devpinger/shared` to strip secret-looking strings
from messages and stack traces).
