# Deploy on Hetzner (Docker Compose)

This walks you through running `@devpinger_bot` on a Hetzner CX22 (€4/mo,
2 vCPU, 4 GB RAM, Ubuntu 24.04). Same recipe works on any VPS with Docker.

## 1. Provision the VPS

1. Sign up at https://hetzner.com/cloud, create a CX22 with Ubuntu 24.04.
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

## 4. Clone the repo and write `.env`

```sh
git clone https://github.com/Guck111/devpinger.git
cd devpinger
cp .env.example .env
$EDITOR .env
```

Fill in every required variable. Minimum set:

- `PUBLIC_BASE_URL` — `https://your-domain.example` (your real public URL).
- `TELEGRAM_BOT_TOKEN` — from `@BotFather`.
- `TELEGRAM_BOT_USERNAME` — without leading `@`.
- `TELEGRAM_WEBHOOK_SECRET` — 16+ char random string.
- `ENCRYPTION_KEY` — 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`,
  `GITHUB_OAUTH_REDIRECT_URI`, `GITHUB_WEBHOOK_SECRET_SEED`.
- `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET`,
  `JIRA_OAUTH_REDIRECT_URI` (if you want Jira).
- `POSTGRES_PASSWORD` — non-default for prod.

## 5. Put a reverse proxy in front

Telegram requires HTTPS for `setWebhook`. Pick one:

### Option A: Caddy (simplest, auto-TLS)

```sh
sudo apt install caddy
sudo $EDITOR /etc/caddy/Caddyfile
```

```caddyfile
your-domain.example {
  reverse_proxy localhost:3001
}
```

```sh
sudo systemctl reload caddy
```

### Option B: Cloudflare Tunnel

```sh
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo install cloudflared /usr/local/bin/
cloudflared tunnel login
cloudflared tunnel create devpinger
cloudflared tunnel route dns devpinger your-domain.example
```

Config `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/devpinger/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: your-domain.example
    service: http://localhost:3001
  - service: http_status:404
```

Start as a service: `sudo cloudflared service install`.

## 6. Build and start

```sh
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f server worker
```

Database migrations run automatically (see `migrate` service in
`docker-compose.prod.yml`).

## 7. Smoke check

```sh
curl https://your-domain.example/health
# → {"status":"ok","db":"ok","redis":"ok","ts":"…"}
```

Then in Telegram: `/start` to `@your_bot_username`.

## 8. Updates

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Graceful shutdown is built in (10s server, 30s worker), so rolling
deploys do not drop in-flight webhooks or notification jobs.

## 9. Backups

Daily snapshot of the postgres volume:

```sh
docker run --rm \
  -v devpinger_postgres_data:/data \
  -v /home/devpinger/backups:/backup \
  alpine \
  tar czf /backup/postgres-$(date +%F).tar.gz -C /data .
```

Plug that into cron + offsite copy (rclone, restic) to taste.
