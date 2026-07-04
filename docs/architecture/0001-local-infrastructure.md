# Architecture 0001 — Local Infrastructure

Status: **IMPLEMENTED**

## Scope

Step 1 establishes only the local runtime foundation:

- React 19 + Vite 8 web shell.
- Tailwind CSS 4 through the official Vite integration.
- Fastify 5 API with `GET /health`.
- Signal-aware graceful shutdown for `SIGINT` and `SIGTERM`.
- PostgreSQL 18 with a named Docker volume.
- Caddy serving static web files and proxying `/api/*`.
- Docker Compose health checks and dependency ordering.
- Rotating container logs with bounded size.
- Local smoke test through the real Caddy entrypoint.

## Local request path

```text
Browser
  -> http://localhost:8080
  -> Caddy
       -> static React files
       -> /api/* (strip /api)
          -> Fastify :3000
PostgreSQL :5432
  -> named volume nhdp_postgres_data
```

## Deliberate exclusions

Step 1 does not introduce:

- Drizzle ORM, SQL migrations, or application tables.
- Catalog, orders, order lines, bills, or service requests.
- Authentication or sessions.
- SSE.
- Cloudinary.
- Revenue analytics, inventory, booking, or payment.

## Acceptance criteria

1. `pnpm check` passes.
2. API unit tests pass.
3. `docker compose config --quiet` passes.
4. PostgreSQL, API, and Caddy report healthy.
5. `GET /api/health` works through Caddy.
6. The web shell loads through Caddy.
7. PostgreSQL data is mounted to `nhdp_postgres_data`.
8. No application container writes unbounded Docker logs.
