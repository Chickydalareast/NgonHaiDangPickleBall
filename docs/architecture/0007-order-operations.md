# Architecture 0007 — Order Operations

Status: **IMPLEMENTED**

## Scope

Step 7 adds the first writable admin bill workflow:

- Read a bill with all orders and lines.
- Accept a pending order.
- Mark an accepted order as served.
- Cancel a pending or accepted order with a reason.
- Add an available catalog item to an open bill.
- Change quantity on an active line before the order is served.
- Void an active line with a reason.
- Recalculate order and bill totals transactionally.

## State transitions

- `PENDING -> ACCEPTED`
- `ACCEPTED -> SERVED`
- `PENDING | ACCEPTED -> CANCELLED`

Repeated or skipped transitions return a typed conflict. Cancelling an order voids all active lines before totals are recalculated.

## Manual items

A manual add creates one internal order with an `admin:` idempotency-key prefix and status `ACCEPTED`. This preserves the existing order-line ownership model and distinguishes admin-origin orders without a schema migration.

## Transaction boundary

Every mutation acquires a PostgreSQL transaction advisory lock keyed by bill ID. The mutation, activity log, order-total recalculation and bill-total recalculation commit together. Realtime events publish only after commit and remain advisory.

## Edit rules

- Quantity can change only for an active line whose order is `PENDING` or `ACCEPTED`.
- Void is allowed for active lines on any non-cancelled order while the bill remains open.
- Completed or cancelled bills are immutable in this step.
- Prices are always loaded from PostgreSQL for manual additions.

## API

- `GET /api/admin/bills/:billId`
- `POST /api/admin/bills/:billId/items`
- `PATCH /api/admin/orders/:orderId/status`
- `PATCH /api/admin/order-lines/:lineId`
- `POST /api/admin/order-lines/:lineId/void`

## Realtime

Step 7 extends the admin event union with:

- `order.accepted`
- `order.served`
- `order.cancelled`
- `bill.updated`

Each event carries only service-point, bill and order identifiers. The admin client refetches authoritative snapshots.

## Database impact

No migration. The current order, order-line, bill and activity-log schema already supports Step 7.

## Exclusions

- Bill completion.
- Reopening a completed bill.
- Price override.
- Catalog editing.
- Service-request operations.
