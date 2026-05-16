#!/usr/bin/env bash
set -euo pipefail

# Usage: ./restore-postgres.sh /path/to/devpinger-YYYY-MM-DD_HH-MM-SS.dump
# WARNING: this DROPS and recreates the database.

DUMP_FILE="${1:?path to .dump file required}"
CONTAINER="${POSTGRES_CONTAINER:-devpinger-postgres-1}"
DB_USER="${POSTGRES_USER:-devpinger}"
DB_NAME="${POSTGRES_DB:-devpinger}"

[[ -f "$DUMP_FILE" ]] || { echo "dump not found: $DUMP_FILE" >&2; exit 1; }

echo "Restoring $DUMP_FILE into $DB_NAME (in $CONTAINER). This DROPS the existing DB."
read -r -p "Type 'yes' to continue: " confirm
[[ "$confirm" == "yes" ]] || { echo "aborted"; exit 1; }

docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;"
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl < "$DUMP_FILE"

echo "Restore complete."
