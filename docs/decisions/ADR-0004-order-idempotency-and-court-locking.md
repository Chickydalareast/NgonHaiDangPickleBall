# ADR-0004 — Order idempotency and court-scoped locking

Status: **ACCEPTED**

## Decision

Use PostgreSQL transaction-scoped advisory locks for order idempotency and OPEN bill serialization. Keep the existing unique constraints as database-level invariants.

## Rationale

The V1 deployment uses one API instance, but concurrent mobile retries and simultaneous orders still occur. Database locks make correctness independent of frontend timing and remain valid if multiple API processes are introduced later.

## Consequences

- A duplicated idempotency key returns the existing order.
- Orders for different courts can proceed concurrently.
- Orders for the same court serialize only around the short database transaction.
- Future bill completion must acquire the same `open-bill:<servicePointId>` lock.
