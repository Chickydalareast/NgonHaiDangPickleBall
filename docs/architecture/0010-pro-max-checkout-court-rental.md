# Step 10.PRO.MAX — Checkout-first bill completion and optional court rental

## Locked operational flow

- A court keeps one open bill across many customer/admin order rounds.
- PAID quantities do not close the bill; they belong to payment batches so each payment remains auditable.
- Unpaid quantities are grouped by item, unit price snapshot and line kind in the checkout preview.
- Paid items remain grouped by payment batch; the all-items summary remains available separately.
- Staff must open `Tạm tính` before completion. Completion includes the preview revision and is rejected if the bill changed afterward.
- The final action is enabled only when no order remains PENDING/ACCEPTED and no active quantity remains outstanding.

## Optional court rental

Court rental is not added automatically. Admin may add it to an open court bill.

Inputs:

- Start time in 30-minute increments.
- Whole-hour duration from 1 to 24.

Each one-hour block uses the rate determined by that block start time:

- 05:00–before 17:00: 100,000 VND/hour.
- 17:00–before 19:00: 140,000 VND/hour.
- From 19:00 onward, including after 22:00 and before 05:00: 120,000 VND/hour.
- COURT-03 adds 30,000 VND to every hour.

The rental is stored as one financial line with quantity 1, so it can only be paid as one total amount. Its hourly breakdown and pricing snapshot are stored separately for audit/readback. Leaving early does not reduce the charge.

Ticket-based stranger matching, booking and split court payment are excluded.

## Data additions

- `court_rental_charges` stores court rental pricing snapshots and hourly breakdown.
- `payment_batches` stores each PAID event.
- `order_line_settlements.payment_batch_id` links paid line allocations to a payment event.

## Authority

- Frontend never computes official rental or settlement totals.
- Server validates every allocation and computes all official values in a transaction.
- Existing quantity settlement, idempotency, advisory-lock and terminal-bill rules remain authoritative.
