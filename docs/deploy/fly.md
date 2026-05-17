# Deploy on Fly.io

Two Fly Machines (`server` + `worker`), one managed Postgres app, one
Upstash Redis. Suitable for small/medium installs (free tier covers
hobby use; ~$5/mo with persistent Postgres).

## 1. Prereqs

```sh
brew install flyctl   # or curl -L https://fly.io/install.sh | sh
fly auth login
```

## 2. Postgres

```sh
fly postgres create --name devpinger-db --region fra --vm-size shared-cpu-1x
# Copy the DATABASE_URL it prints — you'll need it.
```

## 3. Redis

[Upstash](https://upstash.com) free tier works fine, or Fly Redis:

```sh
fly redis create   # follow prompts, choose region
# Copy the rediss:// URL.
```

## 4. Create `fly.toml` for the server

```toml
app = "devpinger-server"
primary_region = "fra"

[build]
dockerfile = "apps/server/Dockerfile"

[env]
NODE_ENV = "production"
PORT = "3001"

[http_service]
internal_port = 3001
force_https = true
auto_stop_machines = false
auto_start_machines = true
min_machines_running = 1

[[http_service.checks]]
interval = "30s"
timeout = "5s"
grace_period = "20s"
method = "GET"
path = "/health"
```

## 5. Create `fly.worker.toml` for the worker

```toml
app = "devpinger-worker"
primary_region = "fra"

[build]
dockerfile = "apps/worker/Dockerfile"

[env]
NODE_ENV = "production"

[processes]
worker = "pnpm exec tsx src/index.ts"
```

(Workers don't expose HTTP — no `http_service` block.)

## 6. Set secrets (shared between both apps)

```sh
fly secrets set \
  DATABASE_URL=postgres://… \
  REDIS_URL=rediss://… \
  TELEGRAM_BOT_TOKEN=… \
  TELEGRAM_BOT_USERNAME=dev_pinger_bot \
  TELEGRAM_WEBHOOK_SECRET=… \
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  GITHUB_OAUTH_CLIENT_ID=… \
  GITHUB_OAUTH_CLIENT_SECRET=… \
  GITHUB_OAUTH_REDIRECT_URI=https://devpinger-server.fly.dev/oauth/github/callback \
  GITHUB_WEBHOOK_SECRET_SEED=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  JIRA_OAUTH_CLIENT_ID=… \
  JIRA_OAUTH_CLIENT_SECRET=… \
  JIRA_OAUTH_REDIRECT_URI=https://devpinger-server.fly.dev/oauth/jira/callback \
  PUBLIC_BASE_URL=https://devpinger-server.fly.dev \
  --app devpinger-server

# Repeat for worker (it needs DATABASE_URL, REDIS_URL, ENCRYPTION_KEY,
# TELEGRAM_BOT_TOKEN at minimum):
fly secrets set DATABASE_URL=… REDIS_URL=… ENCRYPTION_KEY=… \
  TELEGRAM_BOT_TOKEN=… --app devpinger-worker
```

## 7. Run migrations once

```sh
fly ssh console --app devpinger-server -C "pnpm --filter @devpinger/db migrate"
```

## 8. Deploy

```sh
fly deploy --app devpinger-server   --config fly.toml
fly deploy --app devpinger-worker   --config fly.worker.toml
```

## 9. Verify

```sh
curl https://devpinger-server.fly.dev/health
fly logs --app devpinger-server
fly logs --app devpinger-worker
```

## Notes

- `auto_stop_machines = false` is intentional — webhooks must wake the
  server within Telegram's 5s SLA. Fly's cold starts are ~1-2s, but for
  reliability keep at least one machine running.
- Worker has no public endpoint, so cold starts don't matter there; you
  can set `auto_stop_machines = true` on it if you want.
- Scale workers horizontally: `fly scale count 2 --app devpinger-worker`.
  BullMQ handles job distribution.
