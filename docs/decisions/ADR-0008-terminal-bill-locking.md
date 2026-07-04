# ADR-0008 — Terminal Bill Completion Locking

Status: **ACCEPTED**

## Decision

Bill completion uses both the service-point open-bill advisory lock and the bill advisory lock before locking the bill row.

## Why

The service-point lock serializes completion with customer order creation. The bill lock serializes completion with accept, serve, cancel, manual add, quantity change and void operations. This prevents an order from being attached to a bill while it is becoming terminal.

## Completion rule

A bill cannot complete while any order is `PENDING` or `ACCEPTED`. `SERVED` and `CANCELLED` are terminal for Step 8.

## Consequences

- Completed bills are immutable through all V1 mutation endpoints.
- The partial unique index allows the next order to create a fresh open bill.
- No Redis, distributed lock or migration is needed for the one-process V1 deployment.
- Reopening a bill remains explicitly outside V1.
