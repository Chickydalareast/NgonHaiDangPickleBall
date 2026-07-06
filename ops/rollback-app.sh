#!/usr/bin/env sh
set -eu

TARGET_COMMIT=${1:?Usage: ops/rollback-app.sh <40-character-commit-sha>}
COMPOSE_FILE=${COMPOSE_FILE:-compose.production.yaml}
ENV_FILE=${ENV_FILE:-.env.production}

case "$TARGET_COMMIT" in
  *[!0-9a-f]*|'')
    echo 'TARGET_COMMIT must contain lowercase hexadecimal characters only.' >&2
    exit 1
    ;;
esac

if [ "${#TARGET_COMMIT}" -ne 40 ]; then
  echo 'TARGET_COMMIT must be a full 40-character SHA.' >&2
  exit 1
fi

if [ -n "$(git status --short)" ]; then
  echo 'Rollback refused because the deployment checkout is dirty.' >&2
  exit 1
fi

git fetch --prune origin
git cat-file -e "$TARGET_COMMIT^{commit}"
git checkout --detach "$TARGET_COMMIT"

APP_COMMIT_SHA=$TARGET_COMMIT docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api caddy
APP_COMMIT_SHA=$TARGET_COMMIT docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait api caddy

printf 'Application rollback completed at %s. Database was not restored.
' "$TARGET_COMMIT"
