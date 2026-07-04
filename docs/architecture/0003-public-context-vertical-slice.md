# Architecture 0003 — Public Context Vertical Slice

Status: **IMPLEMENTED_PENDING_CTO_VERIFICATION**

## Goal

Connect the seeded PostgreSQL catalog to the first real customer-facing route:

```text
PostgreSQL
→ Drizzle repository
→ Fastify public endpoint
→ shared Zod contract
→ TanStack Query
→ React customer menu
```

The pilot URL is:

```text
http://localhost:8080/s/san-01
```

The public API is:

```text
GET /api/public/service-points/:slug/context
```

Caddy strips the `/api` prefix before proxying to Fastify.

## Contract boundary

`@nhdp/contracts` owns the runtime Zod schemas and inferred TypeScript types used by both API and web. The API validates the response before returning it, and the web validates untrusted JSON again before rendering.

The contract exposes only customer-safe fields:

- active venue identity
- active service point identity
- active categories
- active and currently available catalog items
- integer VND price
- optional Cloudinary image metadata
- generation timestamp

Internal statuses, admin fields, password data, and transaction data are not exposed.

## Query policy

The repository reads the service point and venue, then active categories and available items in one Drizzle transaction. Sorting is deterministic by `sort_order` and name.

Inactive venues, inactive service points, inactive categories, inactive products, and unavailable products are excluded.

## UI policy

The menu is mobile-first and reload-safe at `/s/:slug`. TanStack Query owns server state. React Router owns URL state. Step 3 intentionally does not include cart state, order submission, bill data, authentication, SSE, or Cloudinary URL generation.

## Verification

Step 3 is accepted only when:

1. shared contracts build before API and web consumers
2. API unit tests cover 200 and typed 404 responses
3. the real repository returns 3 categories and 6 seeded items
4. Docker images build with the workspace contract package
5. HTTP verification passes through Caddy
6. `/s/san-01` renders after a direct browser reload
7. all three containers remain healthy
