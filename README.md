# Ngon Hải Đăng Pickleball

Clean rebuild of the **Court Ordering & Live Bill System**.

## Status

- Step 0 — clean monorepo foundation: complete.
- Step 1 — local infrastructure: complete.
- Step 2 — database foundation: complete.
- Step 3 — public context vertical slice: implemented, pending CTO verification.
- Cart, order creation, bill mutation, authentication, SSE, and Cloudinary delivery are intentionally not implemented yet.

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
pnpm public:verify
```

Customer menu:

```text
http://localhost:8080/s/san-01
```

Public API:

```text
http://localhost:8080/api/public/service-points/san-01/context
```

`pnpm compose:down` keeps the PostgreSQL named volume. Never add `--volumes` unless database deletion is intentional and explicitly approved.

## Local PostgreSQL / DBeaver

```text
Host: localhost
Port: 5432
Database: nhdp
Username: nhdp
Password: nhdp_local_password
URL: postgresql://nhdp:nhdp_local_password@localhost:5432/nhdp
SSL: disabled
```

These are local development defaults. The ignored `.env` is the local source of truth if values are changed.

## Database workflow

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm public:verify:db
```

Additional Step 2 verification:

```bash
pnpm db:verify:empty
pnpm db:verify:persistence
```

Docker one-off tools:

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
- `docs/architecture/0003-public-context-vertical-slice.md`
- `docs/decisions/ADR-0001-clean-rebuild.md`
- `docs/decisions/ADR-0002-postgresql-schema-and-migrations.md`
- `docs/decisions/ADR-0003-shared-public-contracts.md`
