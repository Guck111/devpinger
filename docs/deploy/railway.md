# Deploy on Railway

Railway's `Dockerfile` autodetect + per-service deploy works out of the
box with this repo. ~$5/mo gets you postgres + redis + server + worker.

## 1. Create the project

1. Sign in at https://railway.app.
2. New Project → Deploy from GitHub repo → pick your fork of `Guck111/devpinger`.

## 2. Add managed services

In the project canvas: `+ New` →

- **Database → Postgres** (Railway provisions; copy `DATABASE_URL`).
- **Database → Redis** (Railway provisions; copy `REDIS_URL`).

## 3. Configure the `server` service

Railway will auto-create a service from your repo. Open it:

- **Settings → Source → Root Directory**: leave blank (monorepo root).
- **Settings → Build → Dockerfile Path**: `apps/server/Dockerfile`.
- **Settings → Networking**: enable public domain. Note the domain
  (e.g. `devpinger-server-production.up.railway.app`).
- **Variables**: paste from `.env.example`, fill values. `PUBLIC_BASE_URL`
  = the Railway domain (https). `DATABASE_URL` and `REDIS_URL` reference
  the managed services: `${{Postgres.DATABASE_URL}}` and
  `${{Redis.REDIS_URL}}`.

## 4. Add a `worker` service

`+ New → Empty service`, then:

- **Source → Connect Repo** → same repo.
- **Build → Dockerfile Path**: `apps/worker/Dockerfile`.
- **Variables**: copy from `server` (you can use Railway's "Reference
  another service" to share secrets).

The worker has no exposed port; do **not** enable a public domain.

## 5. Migrations

On first deploy and on every schema change:

```sh
railway run --service server -- pnpm --filter @devpinger/db migrate
```

Or set this as a Railway "deploy command" on the server service if you
want it automatic.

## 6. Webhook + OAuth callbacks

In GitHub/Jira OAuth app settings, set callback URLs to:

```
https://<your-railway-server-domain>/oauth/github/callback
https://<your-railway-server-domain>/oauth/jira/callback
```

## 7. Verify

```sh
curl https://<your-railway-server-domain>/health
```

You should see `{"status":"ok","db":"ok","redis":"ok",…}`. In Telegram:
`/start` to your bot.

## Notes

- Railway sleeps inactive containers on the free Hobby plan — keep
  at least the **server** on a paid plan so Telegram webhooks aren't
  delayed by cold starts.
- Logs: `railway logs --service server`, `railway logs --service worker`.
- One-click template (community-maintained, may lag this README):
  https://railway.app/template — link will be added once published.
