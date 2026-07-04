# ADR-0010 — Immutable Cloudinary public IDs for catalog images

Status: **ACCEPTED**

## Context

Catalog items store Cloudinary metadata, while order lines keep `image_public_id_snapshot`. Order lines do not store a Cloudinary version.

Overwriting or deleting a reused public ID could therefore change or break the image shown for historical orders.

## Decision

- Every catalog image upload receives a new unique public ID scoped to its item.
- The API signs upload parameters; the browser uploads directly to Cloudinary.
- The API verifies Cloudinary's response signature before saving metadata.
- Replacing or detaching an image changes only the current catalog item reference.
- Old Cloudinary assets are retained during V1.
- Media garbage collection is deferred until it can prove that no historical snapshot references an asset.

## Consequences

Historical order image references remain stable. Storage can grow over time, but this is preferable to corrupting transaction history. A later cleanup job must be reference-aware.
