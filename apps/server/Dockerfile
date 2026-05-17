# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/destinations/telegram/package.json packages/destinations/telegram/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sources/github/package.json packages/sources/github/package.json
COPY packages/sources/jira/package.json packages/sources/jira/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS runtime
COPY --from=deps /app /app
COPY apps/server apps/server
COPY packages packages
RUN apk add --no-cache curl tini
# Drop privileges. node:22-alpine ships a "node" user (uid 1000); reuse it
# instead of running as root so a Node-process RCE doesn't give container root.
RUN chown -R node:node /app
USER node
ENV NODE_ENV=production
WORKDIR /app/apps/server
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
