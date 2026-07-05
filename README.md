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

## Step 8 — Bill completion

Admin chỉ hoàn tất bill khi mọi order đã `SERVED` hoặc `CANCELLED`. Completion khóa theo sân và bill, tính lại tổng server-side, chuyển bill sang `COMPLETED`, phát `bill.completed`, đưa sân về trạng thái rảnh và bảo đảm order tiếp theo tạo bill mới.

```bash
pnpm bills:verify:db
pnpm bills:verify
```

## Step 9 — Call staff

Customer có thể gửi một yêu cầu hỗ trợ tại sân với ghi chú tùy chọn. PostgreSQL bảo đảm mỗi sân chỉ có một request `PENDING`; gửi lặp trả lại request hiện có. Admin nhận SSE realtime, xem yêu cầu trên court card và resolve request. Customer polling 15 giây để mở lại nút sau khi nhân viên xử lý.

```bash
pnpm staff:verify:db
pnpm staff:verify
```

## Step 10 — Catalog and Cloudinary

Admin can manage categories, items, prices, display order and selling availability at `/admin/catalog`. V1 treats item quantity as unlimited and does not implement inventory. Images use server-signed direct browser uploads to Cloudinary with immutable public IDs so historical order snapshots remain stable.

```bash
pnpm catalog:verify:db
pnpm catalog:verify
```

Cloudinary is optional locally. Configure all three values together to enable image uploads:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

## Step 10.PRO-A service points and QR

The V1 seed ensures ten courts (`san-01` through `san-10`) without overwriting edits to existing courts.

Authenticated admin endpoints:

```text
GET   /api/admin/service-points
POST  /api/admin/service-points
PATCH /api/admin/service-points/:servicePointId
GET   /api/admin/service-points/:servicePointId/qr.svg
GET   /api/admin/service-points/:servicePointId/qr.png
GET   /api/admin/service-points/qr-pack.zip
```

Useful commands:

```bash
pnpm service-points:verify:db
pnpm service-points:verify
pnpm service-points:qr:export
```

The export command writes `artifacts/qr/nhdp-service-points-qr-pack.zip`. Local QR files use the current `WEB_ORIGIN`; regenerate them after the production domain is configured.

## Step 10.PRO-B provisional bill API

Customers can poll the active court bill without authentication:

```text
GET /api/public/service-points/:slug/bill
```

The response keeps original order history and adds a read-only grouped summary. For example, three bottles in one order and two equivalent bottles in a later order are displayed as five bottles in the provisional summary without merging database rows. Different unit-price snapshots remain separate.

Verification commands:

```bash
pnpm bill-projection:verify:db
pnpm bill-projection:verify
```

## Step 10.PRO-C custom charges

Admin can add non-catalog product fees and interval-based time charges directly to an open bill. These remain auditable order lines and never appear in the public catalog.

```bash
pnpm custom-charges:verify:db
pnpm custom-charges:verify
```

## Step 10.PRO-D partial settlement

Admin settlement is quantity-based and server-priced:

```text
POST /api/admin/order-lines/:lineId/settlements
POST /api/admin/settlements/:settlementId/reverse
```

`PAID` and `WAIVED` allocations update the shared admin/customer bill projection. Reversed rows remain in the audit history but stop contributing to totals. Lines with active settlements cannot be edited, voided or cancelled through their parent order. Bill completion requires every active line quantity to be paid or waived.

```bash
pnpm settlements:verify:db
pnpm settlements:verify
```

## Step 10.PRO-E completion hardening

Step 10.PRO finishes with serialized transaction-scoped bill reads, migration journal integrity checks and concurrency verification for competing allocations, exact idempotent replays, and settlement reversal racing bill completion.

Use the consolidated gates instead of repeating every command manually:

```bash
pnpm migrations:verify
pnpm step10pro:verify:db
pnpm step10pro:verify
```

The full Step 10.PRO branch remains uncommitted until Parts A–E pass CTO review. It is then committed and fast-forward merged once as one operational-completion change set.
