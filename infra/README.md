# DevPinger production deploy (Hetzner Cloud + Supabase)

This directory contains everything needed to run the DevPinger backend on a
single Hetzner Cloud VPS. The lifecycle is intentionally boring: SSH in,
`git pull`, `bash infra/deploy.sh`, done.

## Topology

```
                   ┌────────────────────────┐
                   │  Telegram / GitHub /   │
                   │  Jira / Stripe / users │
                   └────────────┬───────────┘
                                │ HTTPS 443
                                ▼
        ┌───────────────────────────────────────────┐
        │  Hetzner CX23 (Falkenstein, Ubuntu 24.04) │
        │                                           │
        │   ┌──────┐     ┌─────────┐    ┌─────────┐ │
        │   │Caddy │ ──▶ │ server  │ ──▶│  redis  │ │
        │   │ TLS  │     │ Fastify │    │ BullMQ  │ │
        │   └──────┘     │ Grammy  │    └────┬────┘ │
        │                └─────────┘         │      │
        │                                    ▼      │
        │                              ┌─────────┐  │
        │                              │ worker  │  │
        │                              │ BullMQ  │  │
        │                              └─────────┘  │
        └───────────────────────┬───────────────────┘
                                │ TLS
                                ▼
                      ┌───────────────────┐
                      │ Supabase Postgres │
                      │   (EU, Paris)     │
                      └───────────────────┘
```

- The marketing site (`preorder.devpinger.com`) is built from a separate private repo (`Guck111/devpinger_preorder`) and hosted on Cloudflare Workers — it never touches this VPS. It calls back into `api.devpinger.com` for the preorder seat counter and email subscriptions; that allow-list lives in `LANDING_ALLOWED_ORIGINS`.
- Backend API is exposed at `api.devpinger.com` with Let's Encrypt TLS via Caddy.
- Postgres is managed by Supabase. The VPS connects via the transaction pooler.
- Redis is local, ephemeral. BullMQ queues only.

## Files

| File | Purpose |
|------|---------|
| `setup-server.sh` | One-shot bootstrap for a fresh Ubuntu 24.04 VPS: Docker, swap, fail2ban, SSH hardening, unattended security upgrades. |
| `Dockerfile` | Multi-stage build with `server` and `worker` targets. |
| `docker-compose.prod.yml` | Stack: redis + server + worker + Caddy. |
| `Caddyfile` | TLS reverse proxy with a small allow-list of public paths. |
| `.env.prod.example` | Template for production environment variables. Copy to `<repo>/.env.prod`. |
| `deploy.sh` | `git pull` + rebuild + restart. Run on the server. |
| `backup-postgres.sh` | Legacy daily Postgres dump (kept for reference; not used when Postgres is on Supabase). |
| `restore-postgres.sh` | Companion restore script. |

## First-time deploy

Assumes you have:

- A Hetzner CX23 server with Ubuntu 24.04 base image (no Apps preinstalled)
- The Hetzner firewall `devpinger-fw` attached, allowing TCP 22 / 80 / 443 + ICMP
- An SSH key in `~/.ssh/devpinger` reachable as `root@<server-ip>`
- A Supabase Postgres project (transaction pooler URL in hand)
- A Telegram bot token and OAuth app credentials for GitHub/Jira
- DNS record `api.devpinger.com` → server IPv4, *DNS-only* (no proxy) on Cloudflare

### 1. Run the bootstrap on the server

```bash
ssh -i ~/.ssh/devpinger root@<server-ip>
curl -fsSL https://raw.githubusercontent.com/Guck111/devpinger/main/infra/setup-server.sh -o setup-server.sh
bash setup-server.sh
```

Takes ~3 minutes. After completion the server is hardened, has 2 GB swap, and
Docker is running.

### 2. Clone the repo

```bash
git clone https://github.com/Guck111/devpinger.git /opt/devpinger
cd /opt/devpinger
```

### 3. Fill in `.env.prod`

From your local machine:

```bash
cp infra/.env.prod.example /tmp/.env.prod
# Edit /tmp/.env.prod, fill all the blanks
scp -i ~/.ssh/devpinger /tmp/.env.prod root@<server-ip>:/opt/devpinger/.env.prod
shred -u /tmp/.env.prod
```

Critical values to populate:

- `DATABASE_URL` — Supabase transaction pooler URL (port 6543, `?sslmode=require`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
- `ENCRYPTION_KEY` — generate fresh: `openssl rand -hex 32`. **Persist this** — it decrypts OAuth tokens already in the DB.
- `GITHUB_OAUTH_*`, `JIRA_OAUTH_*`

### 4. First deploy

```bash
bash /opt/devpinger/infra/deploy.sh
```

The first build takes 3-5 minutes (downloads node:22-slim, builds pnpm
workspace). Subsequent builds use the layer cache and finish in ~30 seconds.

### 5. Verify

```bash
docker compose -f /opt/devpinger/infra/docker-compose.prod.yml ps
curl -fsS https://api.devpinger.com/health
```

The first `curl` may fail for ~30 seconds while Caddy provisions the
Let's Encrypt certificate. Check `docker logs <caddy-container>` if it persists.

## Day-to-day deploy

After pushing to `main`:

```bash
ssh -i ~/.ssh/devpinger root@<server-ip>
cd /opt/devpinger
bash infra/deploy.sh
```

That's the whole workflow. Compose rebuilds the changed image and rolls
the container with the same `unless-stopped` policy.

## Logs

```bash
# All services
docker compose -f /opt/devpinger/infra/docker-compose.prod.yml logs -f --tail=200

# Single service
docker compose -f /opt/devpinger/infra/docker-compose.prod.yml logs -f server
docker compose -f /opt/devpinger/infra/docker-compose.prod.yml logs -f worker
docker compose -f /opt/devpinger/infra/docker-compose.prod.yml logs -f caddy
```

## Updating the env

Edit `/opt/devpinger/.env.prod`, then:

```bash
cd /opt/devpinger
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
```

Compose detects the env change and recreates the affected containers.

## Disaster recovery

The VPS holds **no persistent customer data**:

- Postgres → Supabase (separate backups, point-in-time recovery on paid plans)
- Redis → BullMQ job queue only; losing it loses in-flight jobs, not history
- Code → git

To rebuild from scratch: spin up a new Hetzner server, repeat steps 1-4.
The only thing you must keep safe is `ENCRYPTION_KEY` — without it the
OAuth tokens encrypted in the `connections` table become unreadable, and
every user will need to re-authorise GitHub/Jira.

## Cost (May 2026 snapshot)

| Item | Monthly |
|------|---------|
| Hetzner CX23 (2 vCPU / 4 GB / 40 GB NVMe) | $6.14 |
| Hetzner IPv4 | $0.74 |
| Supabase Free | $0 |
| Cloudflare Workers (preorder.devpinger.com) | $0 |
| **Total** | **~$6.88/mo** |
