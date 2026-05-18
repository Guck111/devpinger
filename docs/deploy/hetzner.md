# Deploy on Hetzner (Docker Compose)

This walks you through running `@dev_pinger_bot` on a Hetzner CX23
(~$7/mo, 2 vCPU, 4 GB RAM, Ubuntu 24.04). Same recipe works on any
VPS with Docker. The managed `@dev_pinger_bot` runs on this stack;
[infra/README.md](../../infra/README.md) has the opinionated topology
(Caddy + Supabase Postgres) and the bootstrap script.

## 1. Provision the VPS

1. Sign up at https://hetzner.com/cloud, create a CX23 with Ubuntu 24.04.
2. Add your SSH key during provisioning.
3. SSH in: `ssh root@<server-ip>`.

## 2. Harden the box (recommended)

```sh
adduser devpinger
usermod -aG sudo devpinger
rsync --archive --chown=devpinger:devpinger ~/.ssh /home/devpinger
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Disable root SSH login if you wish (`/etc/ssh/sshd_config`).

## 3. Install Docker + Compose plugin

```sh
curl -fsSL https://get.docker.com | sh
usermod -aG docker devpinger
```

Log out and back in as `devpinger`. Verify: `docker compose version`.

## 4. Clone the repo and write `.env.prod`

```sh
git clone https://github.com/Guck111/devpinger.git
cd devpinger
cp infra/.env.prod.example .env.prod
$EDITOR .env.prod
```

Fill in every required variable. Minimum set:

- `PUBLIC_BASE_URL` — `https://your-domain.example` (your real public URL).
- `DATABASE_URL` — managed Postgres (Supabase, Neon, RDS). The prod
  compose stack does **not** ship Postgres.
- `TELEGRAM_BOT_TOKEN` — from `@BotFather`.
- `TELEGRAM_BOT_USERNAME` — without leading `@`.
- `TELEGRAM_WEBHOOK_SECRET` — 16+ char random string.
- `ENCRYPTION_KEY` — 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`,
  `GITHUB_OAUTH_REDIRECT_URI`.
- `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET`,
  `JIRA_OAUTH_REDIRECT_URI` (if you want Jira).
- `STRIPE_WEBHOOK_SECRET` — required when `NODE_ENV=production`; the
  env validator refuses to boot otherwise. Leave the Stripe Payment
  Link disabled if you're not running the preorder smoke test.

## 5. Reverse proxy / TLS

Telegram requires HTTPS for `setWebhook`. `infra/docker-compose.prod.yml`
already includes a Caddy service that terminates TLS via Let's Encrypt
on ports 80/443 and proxies to the server. The allow-list of public
paths lives in `infra/Caddyfile`. Point a DNS A record for your domain
at the server's IPv4 *before* starting the stack so Caddy can complete
HTTP-01 issuance.

If you'd rather terminate TLS elsewhere (Cloudflare Tunnel, an external
Caddy/nginx), comment the `caddy` service out of
`infra/docker-compose.prod.yml`, expose `server:3001`, and front it
yourself.

## 6. Build, migrate, and start

If you're driving deploys through the shipped GitHub Actions workflow
(`.github/workflows/ci.yml`), migrations run automatically against
`PRODUCTION_DATABASE_URL` before the SSH deploy step — push to `main`
and the schema + containers update together.

For manual deploys, apply migrations once before bringing the stack
up, and again on every release that touches
`packages/db/drizzle/`:

```sh
# From your laptop (or any host with Node + pnpm and network to DATABASE_URL):
DATABASE_URL=... pnpm --filter @devpinger/db migrate

# On the VPS:
bash infra/deploy.sh
# or, directly:
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f infra/docker-compose.prod.yml logs -f server worker
```

`pnpm db:migrate` is idempotent — re-running on an up-to-date DB is
a no-op.

## 7. Smoke check

```sh
curl https://your-domain.example/health
# → {"status":"ok","db":"ok","redis":"ok","ts":"…"}
```

Then in Telegram: `/start` to `@your_bot_username`.

## 8. Updates

```sh
git pull
DATABASE_URL=... pnpm --filter @devpinger/db migrate  # if migrations changed
bash infra/deploy.sh
```

Graceful shutdown is built in (10s server, 30s worker), so rolling
deploys do not drop in-flight webhooks or notification jobs.

## 9. Backups

If `DATABASE_URL` points at a managed Postgres (Supabase / Neon / RDS)
— the recommended path — use that provider's backups. Point-in-time
recovery on paid tiers is the simplest answer.

If you run Postgres yourself in Docker, the legacy helpers
`infra/backup-postgres.sh` and `infra/restore-postgres.sh` do nightly
`pg_dump -Fc` against a local `devpinger-postgres` container with
30-day retention (`pg_dump` is safe on a running database, unlike a
`tar` of the volume which can produce a corrupt cold copy):

```sh
sudo cp /opt/devpinger/infra/backup-postgres.sh /usr/local/bin/devpinger-backup
chmod +x /usr/local/bin/devpinger-backup

# 03:00 UTC nightly. Override container/db names via env if your stack differs.
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/devpinger-backup >> /var/log/devpinger-backup.log 2>&1") | crontab -
```

**Critical:** back up your `.env.prod` separately — losing
`ENCRYPTION_KEY` means no user can decrypt their stored OAuth tokens,
forcing every user to reconnect. Push dumps off-host (rclone to S3-
compatible storage, or restic) so a host loss doesn't take both
production data AND its only copy.

Test the restore at least once on a throwaway compose stack:

```sh
./infra/restore-postgres.sh /opt/devpinger/backups/devpinger-<timestamp>.dump
```
