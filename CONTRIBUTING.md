# Contributing

Thanks for considering a contribution. DevPinger is small enough that
the right starting point is usually a thread — open an issue describing
what you'd like to change before you spend a weekend on it. For paid /
revenue features, see the note at the bottom.

## Local setup

[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) walks through Telegram bot
creation, Cloudflare Tunnel, OAuth apps, and running Postgres + Redis.

## Coding style

- TypeScript + Biome. Formatting and lint rules are encoded in
  `biome.json` — `pnpm biome check --write .` before committing.
- Tabs for indentation, double quotes for strings, trailing commas
  where the parser allows them.
- One pattern, one place. If you see a helper duplicated across two
  files, lift it into `@devpinger/shared` or `@devpinger/core` instead
  of writing a third copy.
- Comments earn their keep by explaining *why*. Don't restate what
  the code already says — readers can read code.

## Adding a new source

A source = OAuth + webhook + actions. The contract is in
`@devpinger/core` (`SourceAdapter`). Concrete steps:

1. Create `packages/sources/<name>/` with `package.json`,
   `tsconfig.json`, and `src/`. Copy the structure from
   `packages/sources/github`.
2. Implement:
   - `oauth.ts` — `buildAuthorizeUrl`, `exchangeCodeForToken`,
     `refreshAccessToken?`
   - `client.ts` — thin HTTP wrapper (Bearer auth, retries)
   - `normalize.ts` — webhook payload → `NormalizedEvent[]`
     (Test thoroughly. Normalisation bugs deliver wrong events to the
     wrong people.)
   - `actions.ts` — provider actions called from the bot
   - `adapter.ts` — `createXAdapter({clientId, clientSecret})` returning
     `SourceAdapter`
   - `index.ts` — re-exports
3. Register the adapter in `apps/server/src/registries.ts` and
   `apps/worker/src/registries.ts`.
4. Add OAuth routes
   (`apps/server/src/routes/oauth/<name>.ts`) and a webhook route
   (`apps/server/src/routes/webhooks/<name>.ts`). The webhook route
   should be a thin delegator to `services/ingest.ts`.
5. Add `*_OAUTH_CLIENT_ID`, `*_OAUTH_CLIENT_SECRET`,
   `*_OAUTH_REDIRECT_URI`, and any webhook secret keys to
   `packages/shared/src/env.ts`, plus `.env.example`.
6. Add localized strings to `packages/i18n/src/messages/{en,ru}/bot.json`
   (connect labels, action labels, etc.).
7. Write at least one normalize test
   (`packages/sources/<name>/src/normalize.test.ts`).

## Adding a new destination

Similar shape, smaller surface. Implement `DestinationAdapter` from
`@devpinger/core`:

1. Create `packages/destinations/<name>/`.
2. Implement `client.ts` (the SDK / HTTP wrapper), `format.ts`
   (NormalizedEvent → text + markup), and `adapter.ts` (factory
   returning `DestinationAdapter`).
3. Register in `apps/worker/src/registries.ts`. The notifications
   worker reads from `destinationRegistry`; that's the only wiring
   needed.

## Tests

- `pnpm test` runs vitest across every package.
- New code paths in normalize / mute / redact / OAuth state should
  ship with tests. Provider adapters can use HTTP fixtures or
  recorded responses.
- Migrations don't have tests; instead `pnpm --filter @devpinger/db
  exec drizzle-kit check` in CI verifies the migrations match the
  schema. Run that locally too after edits to `src/schema/`.

## Commit messages

Conventional commits, lower-case scope: `feat(server): …`,
`fix(db): …`, `chore: …`. Co-author trailers are welcome.

## What stays out of this repo

To keep the license line crisp, anything below ships only in the
private `devpinger-cloud` repo. Don't open a PR adding any of these
here:

- Stripe imports, billing routes, `stripe_*` columns
- AI clients (Anthropic, OpenAI) or AI digest code
- Email transports
- Team / workspace tables
- Anything that mentions plan-gating beyond the `noopPlanGate` stub

If you want to contribute to those, the private repo is open to
maintainers — reach out.
