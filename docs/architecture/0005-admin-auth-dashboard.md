# Architecture 0005 — Admin Authentication and Dashboard

Status: **IMPLEMENTED**

## Scope

Step 5 adds the first protected admin vertical slice:

- Username/password login for the internal admin web.
- Argon2id password verification.
- PostgreSQL-backed sessions with a fixed 12-hour TTL.
- HttpOnly cookie named `nhdp_admin_session`.
- Session restore and current-session logout.
- Reusable admin authentication guard.
- Read-only dashboard snapshot for all service points.
- `/admin/login` and `/admin` web routes.

SSE, order mutations, bill completion, catalog management, accounting features, email, phone numbers, password reset, OAuth, JWT, MFA, and role matrices remain outside this step.

## Identifier migration

The V1 internal account uses `username + password`, not email or phone number. Migration `0001_admin_username_auth.sql` renames `admin_users.email` to `username`, keeps the existing admin id and password hash, and replaces the email constraints with:

- `admin_users_username_unique`
- `admin_users_username_format_check`

The migration refuses to guess identifiers when more than one legacy admin already exists. With one legacy admin, the username becomes `admin`. Seed configuration uses `ADMIN_SEED_USERNAME` and remains idempotent.

## Session policy

- Raw token: 32 cryptographically random bytes encoded as base64url.
- Database value: HMAC-SHA256 of the raw token using `SESSION_SECRET`.
- TTL: fixed 12 hours.
- Sliding expiration: disabled.
- Concurrent sessions: allowed.
- Logout: revoke only the current database session.
- `last_seen_at`: reserved for future audit/sliding-session work and is not written on every request.

Cookie attributes:

- `HttpOnly`
- `SameSite=Strict`
- `Path=/api`
- `Max-Age=43200`
- `Secure` only when `WEB_ORIGIN` uses HTTPS

## API

```text
POST /auth/login
GET  /auth/session
POST /auth/logout
GET  /admin/dashboard
```

Caddy exposes these endpoints under `/api` and strips that prefix before proxying to Fastify.

All auth/dashboard responses use `Cache-Control: no-store`. Missing, malformed, expired, revoked, or inactive-admin sessions return the same typed `AUTHENTICATION_REQUIRED` response. Unknown username, wrong password, and inactive account return the same typed `INVALID_CREDENTIALS` response.

## Dashboard snapshot

The dashboard query returns every service point with:

- Venue and court identity.
- Active/inactive status.
- Current open bill id, opened time, and total, or `null`.
- Pending order count for the open bill.
- Pending service-request flag.

Court state is derived in the UI:

- `INACTIVE` → disabled.
- `ACTIVE` with open bill → occupied/open bill.
- `ACTIVE` without open bill → available.

No database column is added for this derived state. The repository uses one fixed SQL query and does not perform N+1 queries.

## Verification

Step-specific verification includes:

- Route tests for login, strict request validation, restore, logout, protected dashboard, and cookie attributes.
- Real PostgreSQL verification for seed idempotency, Argon2id, token hashing, fixed expiry, revocation, inactive admins, username constraints, and dashboard aggregates.
- HTTP verification through Caddy for login cookie, session restore, dashboard access, logout, and rejection of the revoked cookie.
- Regression verification for public context, transactional ordering, local smoke, builds, lint, typecheck, and existing tests.
