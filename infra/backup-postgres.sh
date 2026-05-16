#!/usr/bin/env bash
set -euo pipefail

# Daily PostgreSQL backup via pg_dump (safe for running databases).
# Adjust paths/variables to your deployment. Recommended cron entry:
#   0 3 * * * /opt/devpinger/infra/backup-postgres.sh >> /var/log/devpinger-backup.log 2>&1

CONTAINER="${POSTGRES_CONTAINER:-devpinger-postgres-1}"
DB_USER="${POSTGRES_USER:-devpinger}"
DB_NAME="${POSTGRES_DB:-devpinger}"
BACKUP_DIR="${BACKUP_DIR:-/opt/devpinger/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +"%Y-%m-%d_%H-%M-%S")
OUTFILE="$BACKUP_DIR/devpinger-$TIMESTAMP.dump"

echo "[$(date -u +%FT%TZ)] backup starting: $OUTFILE"
docker exec -i "$CONTAINER" pg_dump -Fc -U "$DB_USER" "$DB_NAME" > "$OUTFILE"
SIZE=$(du -h "$OUTFILE" | cut -f1)
echo "[$(date -u +%FT%TZ)] backup complete: $OUTFILE ($SIZE)"

# Prune old dumps
find "$BACKUP_DIR" -name "devpinger-*.dump" -mtime "+$RETAIN_DAYS" -delete
echo "[$(date -u +%FT%TZ)] pruned dumps older than ${RETAIN_DAYS}d"

# Optional: upload to S3-compatible storage. Configure rclone remote first.
# rclone copy "$OUTFILE" remote:devpinger-backups/
