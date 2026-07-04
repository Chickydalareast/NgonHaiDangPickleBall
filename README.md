# Ngon Hải Đăng Pickleball

Clean rebuild of the **Court Ordering & Live Bill System**.

## Status

- Step 0 — clean monorepo foundation: complete.
- Step 1 — local infrastructure: complete.
- Step 2 — database foundation: implemented, pending CTO verification.
- Business APIs are intentionally not implemented yet.

## Requirements

- Node.js 24.17.x
- pnpm 11.x through Corepack
- Git
- Docker Desktop with Docker Compose

## Quality gate

```bash
pnpm check
```

## Local stack

```bash
pnpm compose:up
pnpm smoke
```

Open `http://localhost:8080`.

`pnpm compose:down` keeps the PostgreSQL named volume. Never add `--volumes` unless database deletion is intentional and explicitly approved.

## Database workflow

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm db:verify
```

Additional Step 2 verification:

```bash
pnpm db:verify:empty
pnpm db:verify:persistence
```

- `db:verify:empty` creates a disposable database, migrates and seeds it twice, verifies idempotency, then drops it.
- `db:verify:persistence` restarts only the PostgreSQL container and verifies the seeded venue retains the same UUID.
- Seed credentials come from ignored `.env`; the password is never committed or printed.

Docker one-off tools are also available:

```bash
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed
```

## Workspace

```text
apps/
  api/        @nhdp/api
  web/        @nhdp/web
packages/
  contracts/  @nhdp/contracts
infra/
  caddy/
```

## Architecture source of truth

- `docs/architecture/0000-v1-baseline.md`
- `docs/architecture/0001-local-infrastructure.md`
- `docs/architecture/0002-database-foundation.md`
- `docs/decisions/ADR-0001-clean-rebuild.md`
- `docs/decisions/ADR-0002-postgresql-schema-and-migrations.md`
