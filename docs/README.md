# DevPinger documentation

[DevPinger](https://github.com/Guck111/devpinger) is an open-source Telegram bot that delivers GitHub pull requests, CI failures, and Jira Cloud issues to one Telegram chat with inline action buttons (approve, comment, transition, mute). MIT-licensed, self-hostable via Docker Compose, Node.js.

- Open the bot: [@dev_pinger_bot](https://t.me/dev_pinger_bot)
- Source code: [github.com/Guck111/devpinger](https://github.com/Guck111/devpinger)
- Preorder ($9 lifetime, 30 seats): [preorder.devpinger.com](https://preorder.devpinger.com)

## Documentation

| Guide | What's inside |
|---|---|
| [Architecture](ARCHITECTURE.md) | How the codebase is structured. SourceAdapter / DestinationAdapter pattern, the ingest pipeline, registries, extensibility points. |
| [User guide](USER_GUIDE.md) | End-user manual for the managed bot. Commands, inline actions, mute filters, GDPR commands. |
| [Local setup](LOCAL_SETUP.md) | Running DevPinger on your machine for development. Node 22, pnpm, Docker, Cloudflare Tunnel for OAuth callbacks, environment variables. |
| [Self-hosting](SELF_HOSTING.md) | Production deployment via the shipped `docker-compose.prod.yml`. Postgres, Redis, Caddy/TLS, GitHub OAuth, Jira OAuth, encryption key. |
| [Privacy](PRIVACY.md) | What we store, how long, and how to delete. `/unsubscribe`, `/export`, `/forget_event`. Token encryption (AES-256-GCM). |
| [Roadmap](ROADMAP.md) | What's in V1, what's coming next (Stripe-source, Sentry-source, Microsoft Teams, AI digests, email destination). |

## Provider-specific deployment guides

- [Hetzner / generic VPS](deploy/hetzner.md)
- [Fly.io](deploy/fly.md)
- [Railway](deploy/railway.md)

## What V1 ships

| Surface | What you get |
|---|---|
| Sources | GitHub (PRs, reviews, comments, issues, releases, CI failures, direct pushes to default branch) and Jira Cloud (issues, comments, status changes, worklogs, mentions). |
| Delivery | A single Telegram bot — `@dev_pinger_bot`. |
| Inline actions | GitHub: approve, comment, view diff, snooze, mute. Jira: comment, transition, reply, snooze, mute. |
| Filtering | Mute by source, repo, project, or event type. Self-suppression toggle. |
| Auth | Telegram `/start` plus OAuth flows for GitHub and Jira. Tokens stored AES-256-GCM encrypted at rest. |
| Privacy | GDPR commands `/unsubscribe`, `/export`, `/forget_event`. Plan-driven event retention. |

## License

MIT. See the [LICENSE](https://github.com/Guck111/devpinger/blob/main/LICENSE).
