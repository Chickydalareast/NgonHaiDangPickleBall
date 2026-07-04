# Architecture 0010 — Catalog and Cloudinary media

Status: **IMPLEMENTED**

## Scope

Step 10 adds authenticated catalog administration for the single active venue:

- create and update categories;
- create and update items;
- control category/item `ACTIVE|INACTIVE` state;
- control item `is_available` state;
- manage display sort order;
- upload, replace and detach item images through signed direct browser uploads to Cloudinary;
- render Cloudinary item images on the customer menu.

## V1 inventory boundary

V1 does not store or calculate stock quantities. Every item is treated as having unlimited quantity. Availability is controlled only by:

- item record status `ACTIVE|INACTIVE`;
- boolean `is_available`.

Inventory, reservations, decrements, replenishment and low-stock alerts are excluded.

## Catalog API

```text
GET    /api/admin/catalog
POST   /api/admin/catalog/categories
PATCH  /api/admin/catalog/categories/:categoryId
POST   /api/admin/catalog/items
PATCH  /api/admin/catalog/items/:itemId
POST   /api/admin/catalog/items/:itemId/image-signature
PUT    /api/admin/catalog/items/:itemId/image
DELETE /api/admin/catalog/items/:itemId/image
```

All endpoints require the existing database session.

## Cloudinary flow

1. Admin requests a signature for an existing item.
2. API creates a unique immutable public ID under `nhdp/catalog/items/<itemId>/...` and signs the upload parameters using SHA-256.
3. Browser uploads the file directly to Cloudinary.
4. Browser submits Cloudinary response metadata to the API.
5. API verifies item ownership and the Cloudinary response signature before persisting metadata.

Allowed formats are JPG, JPEG, PNG and WebP. Incoming images are constrained to 1600 × 1600 while preserving aspect ratio.

## Historical-image rule

Each upload uses a new public ID. Replaced or detached Cloudinary assets are not deleted in V1 because historical order lines snapshot only the image public ID. Automatic media garbage collection is deferred.

## Configuration

The following environment values are optional as an all-or-none group:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

Without them, catalog CRUD remains available while image-signature requests return a typed HTTP 503 response.

## Database impact

No migration is required. The catalog and image metadata columns were created in Step 2.
