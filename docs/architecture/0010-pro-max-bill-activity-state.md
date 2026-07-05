# Step X — Operational bill activity state

## Locked rule

An open bill is an internal shell and does not by itself mean that a court is operationally active.

The dashboard lifecycle is:

- `NONE`: no open bill.
- `OPEN_EMPTY`: an open bill exists but no order line has ever been created.
- `OPEN_ACTIVE`: the open bill contains at least one order line.

Any order line counts as activity, including:

- catalog products;
- manual products;
- manual time charges;
- court-rental charges represented by a manual-time order line;
- lines later voided because an order was cancelled.

Activity is monotonic during one open bill. Once the bill reaches `OPEN_ACTIVE`, cancelling or voiding every line does not return it to `OPEN_EMPTY`. The court returns to idle only after the bill is completed and there is no open bill.

## Dashboard behavior

- `NONE` and `OPEN_EMPTY` display `Đang rảnh`.
- `OPEN_ACTIVE` displays `Đang hoạt động`.
- An empty open bill reuses the same bill and shows `Thêm phí sân hoặc sản phẩm`.
- An active bill shows `Mở bill và xử lý order`.

## Public current bill

The public endpoint hides an `OPEN_EMPTY` bill and returns the same empty projection as a court with no bill. Once any order line exists, the current bill is visible, including cancelled-order history while cancelled lines remain excluded from monetary totals.

## Persistence

No schema migration is required. Activity is derived from the existence of any `order_lines` row for the current open bill. Historical voided rows are retained, so the state cannot regress within that bill.
