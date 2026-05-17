# Local setup

This walks through running DevPinger on your laptop with a real Telegram
bot and real GitHub / Jira OAuth. The whole thing fits in ~30 minutes the
first time.

## Prerequisites

- Node 22 (`brew install node@22` or `nvm install 22`)
- pnpm 10 (`npm i -g pnpm`)
- Docker Desktop, OrbStack, or Colima — to run Postgres + Redis
- `cloudflared` (`brew install cloudflared`) — for a stable public URL
- A Telegram account with the ability to talk to `@BotFather`

## 1. Create a Telegram bot

In Telegram, open `@BotFather`:

```
/newbot
<name your bot, e.g. DevPinger Dev>
<username, must end in `bot`, e.g. devpinger_dev_bot>
```

Save the token BotFather hands you — it goes into `TELEGRAM_BOT_TOKEN`.
The username (without `@`) goes into `TELEGRAM_BOT_USERNAME`.

## 2. Get a stable public URL via Cloudflare Tunnel

Telegram webhook + GitHub OAuth callback both need a stable HTTPS URL
that points at your laptop. A named Cloudflare Tunnel gives you exactly
that without rotating the URL on every reboot.

```bash
cloudflared tunnel login                # auth in browser
cloudflared tunnel create devpinger-dev # creates tunnel + credentials
```

If you have a domain in Cloudflare (e.g. `devpinger.com`):

```bash
cloudflared tunnel route dns devpinger-dev dev.devpinger.com
```

Then create `~/.cloudflared/devpinger-dev.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: dev.devpinger.com
    service: http://localhost:3001
  - service: http_status:404
```

Start the tunnel (keep it running in a separate terminal):

```bash
cloudflared tunnel run devpinger-dev
```

Your stable URL is now `https://dev.devpinger.com` → `localhost:3001`.

If you don't have a domain in Cloudflare, you can use the free
quick tunnel:

```bash
cloudflared tunnel --url http://localhost:3001
```

…but the URL rotates on every restart, so you'll be updating GitHub /
Jira OAuth callbacks each time. A `.app` / `.dev` domain through
Cloudflare Registrar runs ~$10/year and saves the hassle.

## 3. Create the GitHub OAuth App

GitHub Settings → Developer settings → OAuth Apps → **New OAuth App**:

| Field | Value |
| --- | --- |
| Application name | DevPinger Dev (or anything) |
| Homepage URL | `https://dev.devpinger.com` |
| Authorization callback URL | `https://dev.devpinger.com/oauth/github/callback` |

Save **Client ID** → `GITHUB_OAUTH_CLIENT_ID`. Generate a client secret →
`GITHUB_OAUTH_CLIENT_SECRET`.

## 4. Create the Atlassian (Jira) OAuth App

[developer.atlassian.com](https://developer.atlassian.com) → My Apps →
**Create** → OAuth 2.0 (3LO).

Scopes:

- `read:jira-user`
- `read:jira-work`
- `write:jira-work`
- `offline_access`

Callback URL: `https://dev.devpinger.com/oauth/jira/callback`

Save **Client ID** and **Secret** into `JIRA_OAUTH_CLIENT_ID` /
`JIRA_OAUTH_CLIENT_SECRET`.

## 5. Generate `ENCRYPTION_KEY`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the 64-char hex string into `ENCRYPTION_KEY`.

Generate `TELEGRAM_WEBHOOK_SECRET` the same way (any 16+ random
characters work — `openssl rand -hex 32` is fine too).

## 6. Fill out `.env`

```bash
cp .env.example .env
$EDITOR .env
```

At minimum, set:

- `PUBLIC_BASE_URL=https://dev.devpinger.com`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
- `ENCRYPTION_KEY`
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`,
  `GITHUB_OAUTH_REDIRECT_URI=https://dev.devpinger.com/oauth/github/callback`
- `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET`,
  `JIRA_OAUTH_REDIRECT_URI=https://dev.devpinger.com/oauth/jira/callback`

The rest can stay at defaults.

## 7. Run it

```bash
pnpm install
docker compose up postgres redis -d
pnpm db:migrate
pnpm dev          # turbo runs server + worker in watch mode
```

Open Telegram, find your bot, send `/start`. You should get the welcome
screen with "Connect GitHub" and "Connect Jira" buttons.

## 8. Wire a repo

In the bot:

1. Tap **Connect GitHub**, complete the OAuth flow in the browser.
   You're redirected back to Telegram.
2. Send `/repos` — the bot lists repositories your token can access.
   (Subscribing UI is V1.5 — for now, follow the README's "add a
   subscription" SQL snippet or wire one manually.)
3. Push a PR in that repo and watch it land in the bot.

## Troubleshooting

- **`/start` says nothing** — Telegram long-polling is still finishing
  its `deleteWebhook` clear. Wait 5s and resend.
- **OAuth callback 404s** — your tunnel isn't routing or the callback
  URL in the OAuth app doesn't match `PUBLIC_BASE_URL`. Check both.
- **`ENCRYPTION_KEY must be 64 hex characters`** — the env validator
  refuses anything else; regenerate with the `node -e` command above.
- **Webhook deliveries fail with 401** — the GitHub OAuth App's webhook
  secret doesn't match the subscription's secret. V1 derives the
  secret per-subscription; check
  [apps/server/src/services/ingest.ts](../apps/server/src/services/ingest.ts)
  for the HMAC matching logic.
