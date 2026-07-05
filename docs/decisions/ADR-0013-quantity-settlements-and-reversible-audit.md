# ADR-0013 — Quantity settlements with reversible audit rows

Status: **Accepted for Step 10.PRO-D**

## Context

The venue needs to settle only part of an open bill, distinguish paid quantity from intentionally waived quantity, correct operator mistakes and keep customer/admin provisional totals consistent. V1 must not become an accounting system or depend on a payment gateway.

Storing only aggregate paid values on `bills` or `order_lines` would lose who performed each action, why quantity was waived and how a mistaken operation was corrected. Allowing arbitrary amount allocation would also break the server-owned item price and quantity snapshots.

## Decision

Create one immutable financial allocation row in `order_line_settlements` for each admin action.

Each row stores:

- target bill and order line;
- `PAID` or `WAIVED` type;
- positive quantity;
- copied unit-price snapshot;
- server-calculated amount;
- required waiver reason when applicable;
- creating admin and creation idempotency key;
- `ACTIVE` or `REVERSED` status;
- reversing admin, reason, timestamp and reversal idempotency key.

A reversal does not delete the row. It marks the original allocation `REVERSED`, after which it no longer contributes to the bill projection.

All settlement mutations acquire the existing bill advisory lock. Active allocation totals are checked under that lock before insert, preventing paid plus waived quantity from exceeding the source line quantity.

Order-line edits, voids, custom-charge edits/voids and parent-order cancellation are blocked while any active settlement exists. Bill completion requires every active line quantity to be fully allocated.

## Consequences

### Positive

- Partial settlement is deterministic and quantity-based.
- Historical order-line price snapshots remain authoritative.
- Reversal is auditable without hard delete.
- Double-click and retry safety is explicit for both create and reverse.
- Public and admin totals are derived from the same allocation data.
- Future payment-method metadata can be added without rewriting order lines.

### Trade-offs

- Correcting part of one allocation requires reversing it and creating corrected rows.
- Bill reads require one additional settlement query and projection step.
- Completion becomes stricter: served lines must also be fully paid or waived.

## Rejected alternatives

- Aggregate `paid_vnd` and `waived_vnd` columns on `bills`: insufficient line-level audit and quantity protection.
- Mutable paid/waived columns on `order_lines`: loses individual actions and reversal history.
- Arbitrary amount settlement: can create fractional quantities and contradict item price snapshots.
- Hard-delete on reversal: destroys the audit trail.
