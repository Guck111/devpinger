# Multi-stage build for DevPinger server and worker.
# Two final stages (server, worker) share the same builder layer, so
# `docker compose build` reuses the cache.
#
# Build context expected to be repo root (see docker-compose.prod.yml).

# ---------- Stage 1: deps + build ----------
FROM node:22-slim AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy workspace manifests first to maximise layer cache
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY turbo.json ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY packages packages
RUN find packages -name 'package.json' -not -path '*/node_modules/*' -print

RUN pnpm install --frozen-lockfile --prefer-offline

# Source
COPY apps/server apps/server
COPY apps/worker apps/worker

# Build (transpiles TS → JS in each package's dist/)
RUN pnpm --filter '@devpinger/*' build

# Produce isolated production trees (only prod deps, deduped node_modules)
RUN pnpm --filter @devpinger/server deploy --prod --legacy /out/server
RUN pnpm --filter @devpinger/worker deploy --prod --legacy /out/worker


# ---------- Stage 2: server runtime ----------
FROM node:22-slim AS server
WORKDIR /app

RUN apt-get update -qq && \
	apt-get install -y -qq --no-install-recommends tini curl ca-certificates && \
	rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
COPY --from=builder /out/server .

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD curl -fsS http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]


# ---------- Stage 3: worker runtime ----------
FROM node:22-slim AS worker
WORKDIR /app

RUN apt-get update -qq && \
	apt-get install -y -qq --no-install-recommends tini ca-certificates && \
	rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
COPY --from=builder /out/worker .

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
