#!/usr/bin/env sh
set -eu

COMPOSE_FILE=${COMPOSE_FILE:-compose.production.yaml}
ENV_FILE=${ENV_FILE:-.env.production}
BACKUP_PATH=${1:?Usage: CONFIRM_RESTORE=RESTORE_NHDP_DATABASE ops/restore-postgres.sh /path/to/backup.dump}

if [ "${CONFIRM_RESTORE:-}" != 'RESTORE_NHDP_DATABASE' ]; then
  echo 'Restore refused. Set CONFIRM_RESTORE=RESTORE_NHDP_DATABASE explicitly.' >&2
  exit 1
fi

if [ ! -s "$BACKUP_PATH" ]; then
  echo "Backup does not exist or is empty: $BACKUP_PATH" >&2
  exit 1
fi

if [ -f "$BACKUP_PATH.sha256" ]; then
  sha256sum --check "$BACKUP_PATH.sha256"
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres   pg_restore --list <"$BACKUP_PATH" >/dev/null

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api caddy

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -eu -c   'dropdb --if-exists --force --username "$POSTGRES_USER" "$POSTGRES_DB" && createdb --username "$POSTGRES_USER" "$POSTGRES_DB"'

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -eu -c   'pg_restore --exit-on-error --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"'   <"$BACKUP_PATH"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait api caddy

echo 'Restore completed. Run production smoke and manual critical-flow acceptance now.'
