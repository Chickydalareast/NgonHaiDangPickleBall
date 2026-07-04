# Architecture 0006 — Admin SSE Realtime

Status: **IMPLEMENTED**

## Scope

Step 6 adds one protected realtime vertical slice for the admin dashboard:

- `GET /admin/events` as a cookie-authenticated Server-Sent Events stream.
- In-memory event hub for the single V1 API process.
- `order.created` emitted only after the order transaction commits.
- Event payload contains only `servicePointId`, `billId`, and `orderId`.
- Native browser `EventSource` with automatic reconnect.
- TanStack Query invalidates and refetches the dashboard snapshot when an order event arrives.
- Polling every 15 seconds while realtime is connecting or disconnected.

Order mutations, bill operations, service-request events, catalog events, Redis, PostgreSQL LISTEN/NOTIFY, and durable event replay remain outside this step.

## Event contract

```json
{
  "type": "order.created",
  "servicePointId": "uuid",
  "billId": "uuid",
  "orderId": "uuid"
}
```

The stream sends the SSE event name `order.created`. The JSON data repeats `type` so the shared Zod contract can validate messages independently of transport metadata. No prices, customer notes, catalog data, or full dashboard snapshots are pushed through SSE.

## Commit boundary

The order service returns from its PostgreSQL transaction before publishing. An idempotent replay returns the existing order and does not emit another event. Realtime delivery is advisory: order correctness remains entirely in PostgreSQL, and publish failure must not roll back or invalidate a committed order.

## Connection lifecycle

- Authentication uses the existing `nhdp_admin_session` cookie.
- The route authenticates before hijacking the Fastify response.
- Response type is `text/event-stream`.
- Server sends `retry: 5000` and a heartbeat comment every 15 seconds.
- The connection closes no later than the authenticated session expiry.
- Disconnect and application shutdown remove subscribers and close streams.
- There is no durable replay or Last-Event-ID recovery in V1. A reconnect refetches the dashboard snapshot, so missed events do not corrupt state.

## Frontend behavior

The admin page opens one EventSource only after session restore succeeds. On `order.created`, it invalidates `['admin', 'dashboard']`. EventSource performs browser-managed reconnects. While the stream is not connected, the dashboard query polls every 15 seconds as a fallback.

## Database impact

No migration and no new table. The in-memory hub is correct for the locked V1 topology of one API process. A future multi-instance deployment can replace the publisher with PostgreSQL LISTEN/NOTIFY or Redis without changing the browser event contract.

## Verification

- Unit tests for event publish, unsubscribe, shutdown, and unauthenticated SSE rejection.
- Isolated PostgreSQL verification that one committed order emits one event and an idempotent replay emits none.
- HTTP verification through Caddy that authenticates, opens the SSE stream, creates an order, receives matching IDs, replays the order, and cleans verification data.
- Regression checks for auth, public context, transactional ordering, local smoke, Docker health, lint, typecheck, tests, and builds.
