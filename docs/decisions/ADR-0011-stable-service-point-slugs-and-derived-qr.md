# ADR-0011: Stable service point slugs and derived QR assets

Status: Accepted

## Context

Each physical court needs a QR code that opens the customer flow for exactly that court. Printed QR codes may remain in use for a long time, while court display names and ordering may change.

## Decision

- The service point slug is set at creation and is immutable through admin update APIs.
- QR payloads are derived from `WEB_ORIGIN` and the slug: `/s/{slug}`.
- PNG, SVG and ZIP files are generated on demand and are not persisted in PostgreSQL.
- The printable ZIP contains active service points only and includes a machine-readable manifest.
- Deactivating a service point makes the existing QR resolve to a public 404 without reassigning that slug to another court.

## Consequences

- Printed QR codes stay bound to the original court identity.
- Renaming or reordering a court does not invalidate its QR.
- Correcting a bad slug requires creating a replacement service point and deactivating the old one.
- Production QR files must be regenerated whenever the public origin changes.
