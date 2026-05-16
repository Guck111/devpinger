#!/usr/bin/env bash
set -euo pipefail

# Deploy DevPinger from the current git checkout.
# Run on the production server in /opt/devpinger after a `git pull`.

cd "$(dirname "$0")/.."
REPO_ROOT=$(pwd)

if [[ ! -f .env.prod ]]; then
	echo "Missing .env.prod in $REPO_ROOT — copy infra/.env.prod.example and fill it in." >&2
	exit 1
fi

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

log "Pulling latest code"
git fetch --tags
git pull --ff-only

log "Building images"
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod build

log "Bringing up stack (zero-downtime where possible)"
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --remove-orphans

log "Pruning dangling images"
docker image prune -f >/dev/null

log "Status:"
docker compose -f infra/docker-compose.prod.yml ps
