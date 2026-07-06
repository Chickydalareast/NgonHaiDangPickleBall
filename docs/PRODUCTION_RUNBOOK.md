# NHDP production runbook

## Safety rules

- Use `compose.production.yaml` with an untracked `.env.production`.
- Do not expose the API or PostgreSQL ports on the VPS.
- Do not run `db:seed` during normal deployment.
- Production seed is a one-time bootstrap and requires the exact confirmation value documented below.
- Create and verify a PostgreSQL backup before every migration.
- Record the previous and target 40-character Git commits before deployment.
- Do not restore the database automatically merely because an application health check fails.

## One-time bootstrap

```sh
cp .env.production.example .env.production
# Replace every example value and restrict the file.
chmod 600 .env.production
pnpm env:check:production

docker compose --env-file .env.production -f compose.production.yaml build api caddy
docker compose --env-file .env.production -f compose.production.yaml up -d postgres
docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm migrate
ALLOW_PRODUCTION_SEED=I_UNDERSTAND_THIS_IS_ONE_TIME_BOOTSTRAP \
  docker compose --env-file .env.production -f compose.production.yaml --profile bootstrap run --rm seed
docker compose --env-file .env.production -f compose.production.yaml up -d --wait api caddy
```

After bootstrap, clear `ALLOW_PRODUCTION_SEED`, remove both admin seed credentials from `.env.production`, and do not include the seed service in normal deployment.

## Normal deployment order

1. Verify a clean deployment checkout and record the current commit.
2. Fetch the target commit and verify its signature/source according to the release process.
3. Set `APP_COMMIT_SHA` in `.env.production` to the exact target 40-character commit.
4. Run `BACKUP_DIR=/persistent/path sh ops/backup-postgres.sh`.
5. Build the target API and Caddy images.
6. Run the migration one-off service.
7. Recreate API and Caddy with `--wait`.
8. Verify `/api/health`, `/api/ready`, the web shell, authentication, SSE and critical workflows.
9. Record the backup path, previous commit, target commit and acceptance result.

## Application rollback

Use the previous full commit:

```sh
sh ops/rollback-app.sh <previous-40-character-commit>
```

This rolls back application containers only. It deliberately does not restore PostgreSQL.

## Database restore

Database restore is destructive and must be a separate incident decision. Stop application traffic first, identify the verified backup and run:

```sh
CONFIRM_RESTORE=RESTORE_NHDP_DATABASE \
  sh ops/restore-postgres.sh /persistent/path/nhdp_<timestamp>_<commit>.dump
```

After restore, run production smoke and manual critical-flow acceptance before reopening operations.
