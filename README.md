# Ngon Hải Đăng Pickleball

Clean rebuild of the **Court Ordering & Live Bill System**.

## Status

- Step 0 — clean monorepo foundation: complete.
- Step 1 — local infrastructure: implemented, pending CTO verification.
- Business features are intentionally not implemented yet.

## Requirements

- Node.js 24.17.x
- pnpm 11.x through Corepack
- Git
- Docker Desktop with Docker Compose

## Quality gate

```bash
pnpm check
```

The gate verifies the toolchain, formatting, lint, TypeScript, tests, builds,
environment contract, and Docker Compose configuration.

## Full local stack

Create `.env` from `.env.example` once, then run:

```bash
pnpm compose:up
pnpm smoke
```

Open:

```text
http://localhost:8080
```

Useful commands:

```bash
pnpm compose:ps
pnpm compose:logs
pnpm compose:down
```

`compose:down` keeps the PostgreSQL named volume. Do not add `--volumes` unless
you intentionally want to delete local database data.

## Host development mode

Start only PostgreSQL:

```bash
pnpm infra:up
```

Then run the API and Vite development servers:

```bash
pnpm dev
```

Open:

```text
http://localhost:5173
```

Vite proxies `/api/*` to the local Fastify process.

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
- `docs/decisions/ADR-0001-clean-rebuild.md`
