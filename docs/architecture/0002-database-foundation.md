# Architecture 0002 — Database Foundation

Status: **IMPLEMENTED_PENDING_CTO_VERIFICATION**

## Scope

Step 2 establishes the complete V1 relational foundation without exposing business APIs.

- PostgreSQL 18 is the transactional source of truth.
- Drizzle ORM declares the TypeScript schema.
- Drizzle Kit generates versioned SQL migrations committed to Git.
- `node-postgres` provides the connection pool and checked-out transaction client.
- PostgreSQL `uuidv7()` generates time-ordered primary keys.
- Money is stored as non-negative integer VND.
- Historical order lines store immutable name, unit, image, price, quantity, and total snapshots.
- The seed is idempotent and creates the pilot venue, Sân 01, catalog, and one admin account.

## V1 tables

```text
admin_users
admin_sessions
venues
service_points
catalog_categories
catalog_items
bills
orders
order_lines
service_requests
activity_logs
```

## Database-enforced invariants

- At most one `OPEN` bill exists for a service point.
- An idempotency key can create at most one order.
- At most one `PENDING` service request exists for a service point.
- Prices, quantities, subtotals, and totals cannot be negative.
- `order_lines.line_total_vnd` must equal snapshot price multiplied by quantity.
- Completed, cancelled, served, resolved, and voided states require consistent timestamps and reasons.
- Transactional records use status transitions instead of hard deletion.

## Migration policy

The TypeScript schema and generated SQL migration are both committed. Production deployment must run migrations as an explicit step before restarting the API. The API container includes the migration folder, and Compose exposes one-off `migrate` and `seed` tool profiles.

## Seed policy

The seed is safe to rerun. Natural keys (`slug`, `email`) prevent duplicates. Existing admin passwords are not silently overwritten. The local admin password is read from ignored `.env`; it must be changed before any non-local deployment.

## Verification

Step 2 is accepted only when all of the following pass:

1. Migration and seed on the local development database.
2. Schema, UUIDv7, Argon2id, and required-index verification.
3. Constraint probes executed inside a rolled-back transaction.
4. Migration and seed rerun against a newly created empty verification database.
5. Seed idempotency verification.
6. PostgreSQL container restart with the same venue UUID still present.
7. Full Docker stack health and Caddy smoke test.

## Deliberate exclusions

Step 2 does not implement public catalog routes, order creation, bill mutation, authentication endpoints, sessions, SSE, or Cloudinary upload flows.
