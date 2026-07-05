# Step X.1 — Simplified order flow and shared court bill

## Status

```text
IMPLEMENTED_LOCALLY_UNVERIFIED_ON_TARGET
```

## Product decisions

### Admin order flow

- `PENDING → ACCEPTED` is the only required operational action and is labelled **Xác nhận đơn**.
- The alert card performs that transition directly; a separate order-alert acknowledgement click is no longer required.
- `ACCEPTED → SERVED` remains available as **Đánh dấu đã phục vụ (tùy chọn)**.
- `SERVED` is operational metadata only. Billing and bill completion do not depend on it.

### Checkout

- Opening **Tạm tính** acknowledges every still-ringing order alert on that bill by calling the existing idempotent acknowledgement endpoint for each active order alert.
- Every active line belonging to a non-cancelled order can be settled, including lines in `PENDING` orders.
- Payment batches accept allocations from `PENDING`, `ACCEPTED`, and `SERVED` orders.
- Bill completion requires a fresh checkout revision and zero outstanding quantity, but no longer requires all orders to be `SERVED`.
- Cancelled orders and voided lines remain excluded by the existing transaction and projection rules.

### Customer bill

The public current-bill API already projects the complete open bill for the QR service point, including:

- every order round on the open bill;
- customer and admin-added rounds;
- grouped item totals;
- paid, waived, and outstanding totals;
- court rental and other manual charges.

The mobile page now labels this explicitly as the shared temporary total for the whole court and displays order time for each round.

### Realtime sound

- Order alerts use a sharper three-beep pattern.
- Call-staff alerts use a distinct ring-ring pattern and remain higher priority.
- Repetition becomes faster after 15 and 30 seconds without acknowledgement.
- Cross-tab audio ownership and acknowledgement stop rules remain unchanged.

## Architecture impact

```text
Migration: no
New infrastructure: no
Business money authority: server unchanged
Order state machine: retained
SSE event contract: retained
Public current-bill API contract: retained
```

## Verification intent

- Static checks and all tests.
- Pending order lines can be settled.
- Payment batch can include a pending customer order.
- A fully settled bill can complete while its order remains pending.
- Public bill continues to expose all order rounds of the same open court bill.
- Existing alert idempotency, concurrency, SSE, and cleanup verification remains green.
