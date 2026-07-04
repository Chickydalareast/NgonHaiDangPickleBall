# Architecture Baseline 0000 — V1 Source of Truth

Status: **LOCKED**
Product: **Ngon Hải Đăng Pickleball**
Repository: **ngon-hai-dang-pickleball**

## Product boundary

V1 is a **Court Ordering & Live Bill System**. Customers scan a fixed court QR, view the active menu, submit orders, track order status, view the current provisional bill, and call staff. Admin/staff receive orders, operate orders and bills, manage courts and catalog, and complete bills.

V1 is not accounting, revenue analytics, POS, inventory, booking, CRM, loyalty, vouchers, online payment, multi-branch, thermal printing, desktop, or offline-first software.

## Scale target

- One venue, 1–10 courts.
- About 100–200 browser sessions at peak.
- 1–5 admin/staff devices.
- Expected bursts include 10–20 near-simultaneous orders, retries on weak mobile networks, concurrent views of one bill, and two staff members opening the same bill.

Correctness must come from database transactions, idempotency, and constraints—not frontend timing.

## Locked architecture

- Web: React, Vite, TypeScript strict, React Router, TanStack Query, React Hook Form, Zod, Tailwind CSS, Lucide.
- API: Node.js 24 LTS, Fastify 5, TypeScript strict, Zod, Pino, REST JSON.
- Authentication: database session with HttpOnly cookie; Argon2id password hashing.
- Database: PostgreSQL 18, node-postgres, Drizzle ORM, SQL migrations.
- Realtime: SSE for admin; customer refetch and 10–15 second polling only where needed.
- Media: Cloudinary server-signed direct browser upload.
- Runtime: Caddy + API + PostgreSQL in Docker Compose.
- Network: Cloudflare DNS/security in front of Caddy HTTPS.
- Deployment: private GitHub repository and GitHub Actions.

Do not add Appwrite, MongoDB, Redis, RabbitMQ, Socket.IO, Kubernetes, or microservices to V1.

## Business invariants

1. Frontend never decides official price or total.
2. Money is integer VND.
3. Order lines persist item name, unit, image reference when needed, unit price, quantity, and line total as snapshots.
4. A service point has at most one OPEN bill.
5. The first order opens the bill automatically.
6. Every public order submission carries an idempotency key; retrying the same key returns the original order.
7. Bills, orders, and order lines are not hard-deleted in normal operation.
8. Completed bills are locked; reopening is outside V1.
9. Customer cannot change order status, mark served, complete bills, or submit prices.
10. Transactional persistence is mandatory through a PostgreSQL Docker volume; off-site backup is explicitly outside V1 risk acceptance.

## Build order

0. Clean repository foundation and quality gate.
1. Local Docker/PostgreSQL/Caddy, Fastify health, React shell, graceful shutdown.
2. Drizzle schema, migrations, and seeds.
3. Public context vertical slice.
4. Transactional order creation, open bill, snapshots, idempotency, and concurrency tests.
5. Admin authentication and dashboard.
6. SSE realtime with reconnect and polling fallback.
7. Order operations.
8. Bill completion and lock.
9. Call staff flow.
10. Catalog and Cloudinary.
11. VPS deployment.
12. Load test and pilot.

No later step may bypass a failing earlier quality gate.
