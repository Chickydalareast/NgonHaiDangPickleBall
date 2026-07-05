# ADR-0014 — Serialized bill reads and migration integrity

Status: Accepted for Step 10.PRO-E

## Context

Bill projections are assembled from the bill header, orders, order lines and settlement rows inside a repeatable-read transaction. Earlier code launched several `query()` calls concurrently on one node-postgres `PoolClient`. node-postgres currently queues that usage but emits a deprecation warning and plans to remove it in version 9.

Step 10.PRO-C also exposed a migration-order risk: Drizzle uses journal timestamps to decide which migrations are newer than the last applied row. A non-monotonic timestamp can make an existing database silently skip a migration even when the migration command exits successfully.

## Decision

1. Queries sharing a transaction-scoped `PoolClient` execute sequentially. Parallel queries remain acceptable only when they use a `Pool`, where each query may acquire its own connection.
2. Bill mutation concurrency remains serialized with the existing transaction-scoped advisory lock keyed by bill ID.
3. The repository quality gate validates the Drizzle journal, SQL migrations and snapshots before compilation or tests.
4. A dedicated isolated-database hardening verifier races competing settlement and completion operations and fails on node-postgres overlapping-query deprecation warnings.
5. Step 10.PRO verification is consolidated into static, database and Docker/HTTP rounds.

## Consequences

- Bill snapshots avoid unsupported connection-level query overlap.
- Read latency may include two additional sequential round trips, which is acceptable for the small V1 bill size and 2 GB VPS target.
- Concurrency correctness is continuously checked instead of being inferred from advisory-lock usage.
- Invalid migration ordering fails CI before deployment.
- No schema migration is required for this decision.
