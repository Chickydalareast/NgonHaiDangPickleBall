#!/usr/bin/env sh
set -eu

umask 077

COMPOSE_FILE=${COMPOSE_FILE:-compose.production.yaml}
ENV_FILE=${ENV_FILE:-.env.production}
BACKUP_DIR=${BACKUP_DIR:?Set BACKUP_DIR to a persistent directory outside the repository.}
APP_COMMIT_SHA=${APP_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || printf unknown)}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_PATH="$BACKUP_DIR/nhdp_${TIMESTAMP}_${APP_COMMIT_SHA}.dump"
TEMP_PATH="$BACKUP_PATH.tmp"

mkdir -p "$BACKUP_DIR"

cleanup() {
  rm -f "$TEMP_PATH"
}
trap cleanup EXIT INT TERM

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -eu -c   'pg_dump --format=custom --compress=9 --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"'   >"$TEMP_PATH"

if [ ! -s "$TEMP_PATH" ]; then
  echo "Backup is empty: $TEMP_PATH" >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres   pg_restore --list <"$TEMP_PATH" >/dev/null

mv "$TEMP_PATH" "$BACKUP_PATH"
sha256sum "$BACKUP_PATH" >"$BACKUP_PATH.sha256"

trap - EXIT INT TERM
printf '%s
' "$BACKUP_PATH"
