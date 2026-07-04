# ADR-0005 — Username and Database-Backed Admin Session

Status: **ACCEPTED**

## Context

The V1 admin web is an internal operational tool. It does not need email, phone verification, OAuth, account recovery, or a complex identity platform. The product prioritizes correct bill/order behavior and predictable performance on a small VPS, while preserving a clean path toward future accounting and permission features.

## Decision

Use a unique normalized username and password for the V1 admin account.

- Username format: `^[a-z0-9._-]{3,50}$`.
- Password storage: Argon2id only.
- Session: opaque random token in an HttpOnly cookie.
- Persistence: PostgreSQL `admin_sessions`.
- Stored token value: HMAC-SHA256, never plaintext.
- Expiry: fixed 12 hours, no sliding renewal.
- Multiple devices: allowed.
- Logout: revoke the current session.
- V1 role: `ADMIN` only.

## Consequences

The flow is simple for staff, requires no email/phone infrastructure, and adds negligible runtime overhead. Database sessions can be revoked immediately and can later support session management, richer audit, role/permission checks, MFA, or accounting access controls without changing the login identifier.

The V1 intentionally does not implement password reset, MFA, CAPTCHA, login rate limiting, IP allowlists, JWT, OAuth, or a background session-cleanup job.
