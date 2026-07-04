# ADR-0003 — Shared runtime contracts for public APIs

Status: **ACCEPTED**

## Decision

Use `@nhdp/contracts` as the runtime and compile-time boundary between Fastify and React. Public response schemas are written once with Zod and consumed by both applications.

## Consequences

- The browser never trusts unvalidated JSON.
- API and UI field names cannot drift silently.
- Database rows are mapped to explicit customer-safe DTOs rather than returned directly.
- Docker builds must build and copy the contracts workspace before API or web consumers.
- The contracts package remains domain transport code only; it must not import database or UI modules.
