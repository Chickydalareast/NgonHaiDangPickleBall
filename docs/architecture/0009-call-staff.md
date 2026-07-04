# Step 9 — Call staff

Status: **IMPLEMENTED**

## Scope

- Customer reads the current pending service request for the scanned court.
- Customer creates a service request with an optional message.
- At most one `PENDING` request exists per service point.
- Repeated submissions return the existing pending request instead of creating spam.
- Admin dashboard shows pending request details and resolves the request.
- Admin receives `service-request.created` and `service-request.resolved` through SSE.
- Customer polls pending state every 15 seconds; customer does not open an SSE stream.

## Public API

```text
GET  /api/public/service-points/:slug/service-requests/pending
POST /api/public/service-points/:slug/service-requests
```

Create request body:

```json
{
  "message": "Cần nhân viên hỗ trợ tại sân"
}
```

`message` is optional, trimmed server-side, and limited to 200 characters.

## Admin API

```text
PATCH /api/admin/service-requests/:requestId/resolve
```

The endpoint requires the existing database-backed admin session and accepts no request body.

## Transaction rules

1. Public creation locks `service-request:<servicePointId>` inside the PostgreSQL transaction.
2. The existing partial unique index remains the final database invariant for one pending request per court.
3. A new request references the current open bill when one exists; requests are still allowed without an open bill.
4. Resolve uses the same service-point request lock and a row lock.
5. Activity logs are written for customer creation and admin resolution.
6. Realtime events are published only after commit and carry IDs only.

## Out of scope

- Customer cancellation.
- Request assignment to a named employee.
- Request categories, priority, SLA, notification sound configuration, or history UI.
- Redis, queues, push notifications, SMS, or customer SSE.
- Any database migration; the Step 2 schema already contains the service request table and anti-spam index.
