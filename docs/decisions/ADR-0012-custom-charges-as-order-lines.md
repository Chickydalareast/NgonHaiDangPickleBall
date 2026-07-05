# ADR-0012 — Custom charges are typed order lines

## Status

Accepted for Step 10.PRO-C.

## Decision

Admin-only product and time charges are stored as typed `order_lines` under admin-created orders. They use the same bill lock, snapshot, total-recalculation, audit and realtime mechanisms as catalog lines.

`MANUAL_PRODUCT` has a null catalog reference and explicit name, unit, quantity and price snapshots.

`MANUAL_TIME` additionally stores actual duration and billing interval. Quantity represents server-calculated billable intervals using ceiling rounding.

## Why

This keeps one financial source of truth for provisional bills and future settlement allocation. Creating a fake public catalog item named “Khác” would pollute customer menus and lose the meaning of time-based charges. A separate parallel charge table would duplicate bill-total and settlement logic.

## Consequences

- `catalog_item_id` becomes nullable only for typed manual lines.
- Database constraints enforce valid metadata combinations for every line kind.
- Existing catalog rows remain `CATALOG` through a non-destructive migration default.
- Custom-charge type cannot be changed after creation.
- No inventory or rental-session lifecycle is introduced.
