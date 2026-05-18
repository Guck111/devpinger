# Self-hosting

DevPinger is a managed product first — the easiest path is to use
`@dev_pinger_bot`. If you'd rather run your own instance (privacy, air-gap,
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

The repo ships `infra/docker-compose.prod.yml` which brings up redis,
server, worker, and Caddy (TLS reverse proxy) in one command. Postgres
is **not** part of this stack — point `DATABASE_URL` at a managed
service (Supabase, Neon, RDS, etc.). After filling `.env.prod` at the
repo root:

```sh
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build
```

Migrations are **not** auto-run by the prod compose stack itself; the
shipped `.github/workflows/ci.yml` runs `pnpm db:migrate` against
`PRODUCTION_DATABASE_URL` *before* the SSH deploy, so a push to `main`
gets the schema applied and the containers rolled in one go. For
manual deploys (no CI), apply the same command yourself before
`infra/deploy.sh`:

```sh
DATABASE_URL=... pnpm --filter @devpinger/db migrate
```

Run that from any host with Node 22 + pnpm and network access to the
database (your laptop with the prod `DATABASE_URL` exported works).
The runner is idempotent — re-running on an up-to-date DB is a no-op.

Provider-specific walkthroughs:

- [Hetzner / generic VPS](deploy/hetzner.md) — Docker Compose + Caddy or
  Cloudflare Tunnel for HTTPS.
- [Fly.io](deploy/fly.md) — two Fly Machines (server + worker), managed
  Postgres, Upstash Redis.
- [Railway](deploy/railway.md) — managed Postgres + Redis + per-service
  Dockerfile deploys.

The production multi-stage build lives at `infra/Dockerfile` (two final
targets, `server` and `worker`); the per-app Dockerfiles
(`apps/server/Dockerfile`, `apps/worker/Dockerfile`) are simpler
single-stage variants used by Fly and Railway. Both flavours run as
`node` user with `tini` as PID 1, so signals propagate cleanly and
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
history, and mute rules.

If you point `DATABASE_URL` at a managed service (Supabase, Neon, RDS),
use that provider's backups — point-in-time recovery on paid tiers is
the simplest path.

If you run Postgres yourself in Docker, the legacy helpers
`infra/backup-postgres.sh` and `infra/restore-postgres.sh` do
nightly `pg_dump -Fc` against a local `devpinger-postgres` container
with 30-day retention. Cron snippet:

```sh
0 3 * * * /opt/devpinger/infra/backup-postgres.sh >> /var/log/devpinger-backup.log 2>&1
```

The encryption key is required to decrypt the connections; back it up
separately so a DB-only leak doesn't expose tokens, and so a host loss
doesn't leave the database undecryptable. Test restore at least once on
a throwaway compose stack — an untested backup is a wish, not a backup.

## Webhook secrets

Each GitHub repo subscription gets its own webhook secret minted at
registration time via `randomBytes(32)` (see
[adapter.ts](../packages/sources/github/src/adapter.ts) →
`subscriptionCreate`). Secrets live in `subscriptions.webhook_secret`
encrypted at rest only insofar as the database disk is encrypted —
treat database access and the encryption key as equivalent risk
surfaces.

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
