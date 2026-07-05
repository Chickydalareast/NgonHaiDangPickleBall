# Step X — Realtime staff alerting functional core

## Status

Implementation candidate before UI/UX productization.

## Locked product behavior

- Admin/staff use laptop only and keep an authenticated admin page open during the shift.
- Customer pages remain mobile-first through the fixed QR code of each court.
- A new customer order rings until an admin clicks **Đã nhận**.
- Clicking **Đã nhận** acknowledges only the alert; it does not accept, serve, or cancel the order.
- A new call-staff request rings with higher priority until an admin clicks **Đã xem**.
- Clicking **Đã xem** acknowledges only the alert; the card remains active until the request is resolved.
- Call-staff alerts sort before order alerts. Older events sort first within the same priority.
- One browser tab owns audio playback at a time through a short localStorage lease.
- No Service Worker or Web Push is included in V1. Closing all admin tabs stops alerts.

## Server authority

Acknowledgements are persisted as immutable `activity_logs` entries:

```text
order.alert_acknowledged
service_request.alert_acknowledged
```

This avoids adding a new migration while preserving cross-device state, auditability, idempotent acknowledgement, and protection against ringing acknowledged historical events after refresh or SSE reconnect.

Concurrent acknowledgement calls serialize with PostgreSQL advisory transaction locks. Only the first call creates an activity log; later calls return the existing acknowledgement with `replayed: true`.

## Active alert projection

`GET /admin/alerts` derives the current queue from PostgreSQL:

- Customer orders only: `PENDING`, open bill, idempotency key not prefixed with `admin:`.
- Service requests only: `PENDING`.
- Acknowledgement metadata comes from the first matching immutable activity log.

Acknowledged orders remain in the queue until accepted or cancelled. Acknowledged service requests remain until resolved.

## API

```text
GET   /api/admin/alerts
PATCH /api/admin/alerts/orders/:orderId/acknowledge
PATCH /api/admin/alerts/service-requests/:requestId/acknowledge
```

All routes require the database-backed admin session.

## Realtime events

Existing SSE gains:

```text
order.alert-acknowledged
service-request.alert-acknowledged
```

All order, service-request, and acknowledgement events invalidate the alert projection. SSE remains advisory; PostgreSQL remains the source of truth, with 15-second polling fallback.

## Browser runtime

The admin alert runtime is mounted across all authenticated admin routes and provides:

- one SSE connection for the whole admin area;
- alert projection polling fallback;
- explicit user activation for browser audio;
- two Web Audio patterns, with call-staff priority;
- one-audio-owner lease across tabs;
- aggregate card surface;
- flashing document title while unacknowledged alerts exist;
- operating-system notification for newly arriving alerts while the tab is hidden, when permission is granted.

Visual styling is intentionally provisional and will be replaced during the final UI/UX workstream.

## Exclusions

- Service Worker and Web Push.
- Alerts after closing all admin tabs or the browser.
- Native always-on-top window behavior.
- Mobile/tablet admin layouts.
- Final visual design, iconography, motion system, and brand treatment.
