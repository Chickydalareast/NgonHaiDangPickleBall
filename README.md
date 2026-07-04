# Ngon Hải Đăng Pickleball

Clean VPS-first rebuild of the **QR ordering + live court bill** V1.

## Implemented vertical slices

- Step 0: pnpm TypeScript monorepo foundation
- Step 1: PostgreSQL, Fastify health API, React/Vite shell, Caddy and Docker Compose
- Step 2: Drizzle schema, SQL migration, seed and database verification
- Step 3: public court context from PostgreSQL to customer menu
- Step 4: customer cart and transactional order creation with idempotency
- Step 5: username/password admin authentication and read-only court dashboard

## Requirements

- Node.js `>=24.17.0 <25`
- pnpm `>=11 <12`
- Docker Desktop / Docker Engine with Compose

## Quality gate

```bash
pnpm check
```

The gate runs toolchain validation, formatting, shared-contract build, ESLint, strict TypeScript, tests, production builds, environment validation, and Compose validation.

## Local stack

```bash
pnpm compose:up
pnpm smoke
pnpm public:verify
pnpm order:verify
pnpm auth:verify
```

Customer menu:

```text
http://localhost:8080/s/san-01
```

Cart:

```text
http://localhost:8080/s/san-01/cart
```

Public API:

```text
GET  http://localhost:8080/api/public/service-points/san-01/context
POST http://localhost:8080/api/public/service-points/san-01/orders
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
pnpm order:verify:db
pnpm auth:verify:db
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
- `docs/architecture/0004-create-order-transaction.md`
- `docs/architecture/0005-admin-auth-dashboard.md`
- `docs/decisions/ADR-0001-clean-rebuild.md`
- `docs/decisions/ADR-0002-postgresql-schema-and-migrations.md`
- `docs/decisions/ADR-0003-shared-public-contracts.md`
- `docs/decisions/ADR-0004-order-idempotency-and-court-locking.md`
- `docs/decisions/ADR-0005-username-database-session.md`

## Step 6 — Admin realtime

- Protected SSE endpoint: `GET /api/admin/events`.
- New customer orders publish `order.created` after the database transaction commits.
- Admin dashboard invalidates its snapshot query when the event arrives.
- Native EventSource reconnects automatically; dashboard polling every 15 seconds is the fallback while disconnected.
- The V1 event bus is in-memory because production runs one API process.

## Step 7 — Order operations

Admin có thể mở bill, chấp nhận/phục vụ/hủy order, thêm món thủ công, đổi số lượng line chưa phục vụ và void line. Mọi mutation khóa theo bill, dùng giá server-authoritative, ghi activity log và tính lại order/bill trong cùng transaction.

```bash
pnpm operations:verify:db
pnpm operations:verify
```
