# Architecture 0004 — Create Order Transaction

Status: **IMPLEMENTED_PENDING_CTO_VERIFICATION**

## Scope

Step 4 adds the first transactional write path:

```text
Customer cart
→ POST /api/public/service-points/:slug/orders
→ idempotency lock
→ one OPEN bill
→ order + price snapshots
→ bill total recalculation
→ order confirmation
```

## Server authority

The client sends only `catalogItemId` and `quantity`. Price, item name, unit name, image snapshot, line total, order total, and bill total are calculated by the API from active PostgreSQL catalog rows.

## Concurrency

Two transaction-scoped PostgreSQL advisory locks are used:

1. `order-idempotency:<key>` serializes retries using the same key.
2. `open-bill:<servicePointId>` serializes bill creation and total updates per court.

The partial unique index `one_open_bill_per_service_point` remains the final database constraint.

## Idempotency

The first request creates the order and returns HTTP 201. A retry with the same key and court returns the existing order with `replayed: true` and HTTP 200. The key never creates a second order.

## Frontend

The cart is stored per court in localStorage. Changing cart content resets the pending idempotency key. A network retry reuses the same key until the order succeeds.

## Out of scope

- Admin order acceptance/serving/cancellation
- Customer bill endpoint
- SSE events
- Authentication
- Cloudinary images
