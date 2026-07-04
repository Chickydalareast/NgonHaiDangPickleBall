# Ngon Hải Đăng Pickleball

Clean V1 rebuild for QR ordering and live court bills.

## Current phase

**Step 0 — Reset foundation**

This repository currently contains only monorepo structure, shared TypeScript rules, lint/format configuration, environment contract validation, documentation, and CI quality gates. React, Fastify, PostgreSQL, Caddy, Drizzle, order, and bill implementation begin in later steps.

## Workspace

- `apps/web` → `@nhdp/web`
- `apps/api` → `@nhdp/api`
- `packages/contracts` → `@nhdp/contracts`

## Required toolchain

- Node.js 24.17.0+ within major 24
- pnpm 11.x through Corepack
- Git

## Commands

```bash
pnpm install
pnpm check
```

The full V1 architectural boundary is in `docs/architecture/0000-v1-baseline.md`.
