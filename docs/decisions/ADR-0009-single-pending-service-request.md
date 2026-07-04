# ADR-0009 — One pending call-staff request per court

Status: **Accepted**

## Decision

Use the existing `service_requests` table and partial unique index to allow at most one `PENDING` request for each service point. Serialize create and resolve operations with the PostgreSQL advisory transaction lock `service-request:<servicePointId>`.

A repeated customer submission returns the existing pending request with `replayed: true`. It is not treated as an error and does not publish another realtime event.

## Consequences

- Rapid taps, retries, and concurrent browser requests do not spam the admin dashboard.
- No customer account or idempotency key is required for this lightweight action.
- After admin resolution, the same court may create a new request.
- The in-memory SSE hub remains suitable because production V1 runs one API process; PostgreSQL remains the source of truth.
