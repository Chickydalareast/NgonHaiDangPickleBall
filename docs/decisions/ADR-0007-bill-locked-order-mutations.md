# ADR-0007 — Serialize order mutations by bill

## Status

Accepted.

## Decision

All Step 7 mutations serialize with a PostgreSQL transaction advisory lock derived from the bill ID. Totals are recomputed from active order lines inside the same transaction.

Manual additions create one accepted internal order per command and are identified by an `admin:` idempotency-key prefix. No source column or migration is introduced.

## Consequences

- Concurrent staff actions cannot overwrite one another's bill total.
- Cancel and void operations retain historical rows.
- The database remains the source of truth for prices and totals.
- The current one-process SSE hub can publish after commit without affecting correctness.
