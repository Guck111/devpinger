# DevPinger

GitHub pull requests and Jira issues, delivered to one Telegram inbox.

[**Open the bot →**](https://t.me/dev_pinger_bot) `@dev_pinger_bot`

Tap `/start`, connect GitHub, optionally connect Jira. Events arrive in your
personal chat with inline buttons to approve, comment, merge, transition,
snooze, or mute.

## What V1 ships

| Surface | What you get |
| --- | --- |
| Sources | **GitHub** (PRs, reviews, comments, issues, releases, CI failures) and **Jira Cloud** (issues, comments, status changes, worklogs, mentions). |
| Delivery | A single Telegram bot — `@dev_pinger_bot`. |
| Actions | GitHub: approve, request changes, comment, reply to review comment, merge, close, reopen, assign. Jira: add comment, transition, assign. |
| Filtering | Mute by source, repo, project, or event type. Self-suppression (your own actions don't echo back). |
| Auth | Telegram `/start` + OAuth flows opened from the bot for GitHub and Jira. Tokens are stored AES-256-GCM encrypted. |

## Quick start

The fastest path is the managed bot — just open `@dev_pinger_bot` in Telegram.

If you want to run your own copy, you need Node 22, pnpm 10, Docker (or
another way to run Postgres 16 + Redis 7), and a publicly reachable URL
for OAuth callbacks (Cloudflare Tunnel works well in development).

```bash
git clone https://github.com/Guck111/devpinger.git
cd devpinger
cp .env.example .env  # fill in TELEGRAM_*, GITHUB_*, JIRA_*, ENCRYPTION_KEY

pnpm install
docker compose up postgres redis -d
pnpm db:migrate
pnpm dev
```

Detailed setup (Cloudflare Tunnel, GitHub/Jira OAuth apps, generating
`ENCRYPTION_KEY`) lives in [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

## How it's built

```
apps/
  server/   Fastify HTTP server + grammy Telegram bot
  worker/   BullMQ workers (notifications, snooze, cleanup, oauth-state sweep)
packages/
  core/     SourceAdapter, DestinationAdapter, NormalizedEvent, plans, PlanGate
  crypto/   AES-256-GCM cipher
  db/       Drizzle schema + migrations
  i18n/     en/ru translations
  shared/   env schema, redact, mutes engine
  sources/
    github/  OAuth + Octokit + actions + normalize + adapter
    jira/    OAuth (3LO) + REST client + actions + normalize + adapter
  destinations/
    telegram/  grammy wrapper + format + adapter
```

The split between `apps/server/src/server.ts` (`createApp({extensions})`),
`registries.ts` (source / destination registries), and `services/ingest.ts`
(the webhook -> normalize -> persist -> queue pipeline) is what makes the
codebase extensible without forks. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the long form.

## Adding a new source or destination

1. Implement `SourceAdapter` (or `DestinationAdapter`) from
   `@devpinger/core` in a new package under `packages/sources/`
   (or `packages/destinations/`).
2. Register it in `apps/server/src/registries.ts` and
   `apps/worker/src/registries.ts`.
3. Add the OAuth route (if applicable) and the webhook route to
   `apps/server/src/routes/`. The webhook route should call
   `services/ingest.ts` and let the adapter handle verify + normalize.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Self-hosting

Production deployment is documented in
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md). One-command path with the
shipped `docker-compose.prod.yml`, plus provider-specific guides:

- [Hetzner / generic VPS](docs/deploy/hetzner.md)
- [Fly.io](docs/deploy/fly.md)
- [Railway](docs/deploy/railway.md)

## Privacy

What we store, how long, how to delete: [docs/PRIVACY.md](docs/PRIVACY.md).
TL;DR — `/unsubscribe` removes everything, `/export` gives you a JSON dump,
`/forget_event <id>` forgets one event. OAuth tokens are AES-256-GCM at rest.

## Roadmap

V1.5 brings Microsoft Teams as a source. V2 layers on AI digests, email
delivery, web inbox, and Stripe billing — all in a separate private repo
that consumes `@devpinger/*` packages from here. The full plan is in
[docs/ROADMAP.md](docs/ROADMAP.md).

## License

MIT — see [LICENSE](LICENSE).
