# Architecture 0008 — Bill Completion

Status: **IMPLEMENTED**

## Scope

Step 8 adds the terminal bill flow:

- Admin views the server-authoritative provisional total.
- Admin completes an `OPEN` bill.
- Completed bills reject every Step 7 mutation.
- The dashboard immediately derives the court as free because no `OPEN` bill remains.
- A later customer order creates a new bill for the same court.
- Completion publishes `bill.completed` after the transaction commits.

## API

```text
POST /api/admin/bills/:billId/complete
```

The request has no body. Price and totals are never accepted from the browser.

## Completion invariants

A bill can be completed only when:

- It exists and has status `OPEN`.
- It has no order with status `PENDING` or `ACCEPTED`.
- Every non-cancelled order is therefore `SERVED`.

A zero-value bill may be completed when all orders were cancelled or every line was voided. This keeps the history immutable without inventing an automatic bill-cancellation rule.

## Transaction boundary

Completion runs in one PostgreSQL transaction and acquires locks in this order:

1. `open-bill:<servicePointId>` advisory lock, shared with customer order creation.
2. `bill:<billId>` advisory lock, shared with Step 7 admin mutations.
3. `SELECT ... FOR UPDATE` on the bill row.

Inside the transaction the API:

1. Rechecks that the bill is still open.
2. Rejects unresolved orders.
3. Recalculates subtotal and total from active order lines.
4. Sets `status = COMPLETED` and `completed_at = now()`.
5. Writes `activity_logs` action `bill.completed`.

The SSE event is published only after commit and is best-effort.

## Realtime

```json
{
  "type": "bill.completed",
  "servicePointId": "uuid",
  "billId": "uuid"
}
```

The admin client invalidates both dashboard and bill snapshots.

## Database impact

No migration is required. The initial schema already contains:

- `bills.status`
- `bills.completed_at`
- terminal timestamp consistency constraint
- partial unique index for one open bill per service point

## Exclusions

- Payment method or payment gateway
- Receipt printing
- Reopening a completed bill
- Bill cancellation workflow
- Discounts, taxes or service charges
- Revenue analytics
