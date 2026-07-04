# ADR-0002 — PostgreSQL schema, UUIDv7, and explicit migrations

Status: **ACCEPTED**

## Decision

Use PostgreSQL 18 with Drizzle ORM, generated SQL migrations, and `node-postgres`. Primary keys default to PostgreSQL `uuidv7()`. Application transactions must use one checked-out `PoolClient` for `BEGIN`, all statements, `COMMIT`, and `ROLLBACK`.

## Consequences

- Core concurrency rules are enforced by PostgreSQL constraints and partial unique indexes.
- Migrations are reviewable Git artifacts and are never replaced by runtime schema push.
- IDs remain globally unique while having timestamp order suitable for B-tree locality.
- A future move from one API process to multiple processes does not change the data model.
- PostgreSQL 18 is a hard runtime requirement for the initial migration because it uses built-in `uuidv7()`.
