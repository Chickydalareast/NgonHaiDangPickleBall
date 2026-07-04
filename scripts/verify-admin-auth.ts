import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminDashboardResponseSchema,
  authApiErrorSchema,
  authSessionResponseSchema,
  logoutResponseSchema,
} from '../packages/contracts/dist/index.js';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { z } from 'zod';

const localEnvironment = existsSync('.env')
  ? parse(readFileSync('.env'))
  : parse(readFileSync('.env.example'));

const environmentSchema = z.object({
  ADMIN_SEED_PASSWORD: z.string().min(16).max(200),
  ADMIN_SEED_USERNAME: z.string().regex(/^[a-z0-9._-]{3,50}$/),
  CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
});
const environment = environmentSchema.parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

function tokenHash(rawToken: string): string {
  return createHmac('sha256', environment.SESSION_SECRET).update(rawToken).digest('hex');
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step5-http-verifier',
  });
  let createdTokenHash: string | null = null;

  try {
    const invalidResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: environment.ADMIN_SEED_USERNAME,
        password: environment.ADMIN_SEED_PASSWORD,
        email: 'not-used@nhdp.local',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    assert.equal(invalidResponse.status, 400);
    assert.equal(
      authApiErrorSchema.parse(await invalidResponse.json()).code,
      'INVALID_AUTH_REQUEST',
    );

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: environment.ADMIN_SEED_USERNAME,
        password: environment.ADMIN_SEED_PASSWORD,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.headers.get('cache-control'), 'no-store');

    const loginBody = authSessionResponseSchema.parse(await loginResponse.json());
    const setCookie = loginResponse.headers.get('set-cookie');

    if (!setCookie) {
      throw new Error('Login response did not set the admin session cookie.');
    }

    assert.match(setCookie, /^nhdp_admin_session=/i);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api/i);
    assert.match(setCookie, /Max-Age=43200/i);
    assert.doesNotMatch(setCookie, /; Secure/i);

    const cookiePair = setCookie.split(';')[0];
    assert.ok(cookiePair);
    const rawToken = cookiePair.slice(cookiePair.indexOf('=') + 1);
    assert.match(rawToken, /^[A-Za-z0-9_-]{43}$/);
    createdTokenHash = tokenHash(rawToken);

    const storedSession = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM admin_sessions WHERE token_hash = $1`,
      [createdTokenHash],
    );

    assert.equal(storedSession.rows[0]?.token_hash, createdTokenHash);
    assert.notEqual(rawToken, createdTokenHash);

    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: {
        Accept: 'application/json',
        Cookie: cookiePair,
      },
      signal: AbortSignal.timeout(15_000),
    });

    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(authSessionResponseSchema.parse(await sessionResponse.json()), loginBody);

    const dashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: {
        Accept: 'application/json',
        Cookie: cookiePair,
      },
      signal: AbortSignal.timeout(15_000),
    });

    assert.equal(dashboardResponse.status, 200);
    const dashboard = adminDashboardResponseSchema.parse(await dashboardResponse.json());
    assert.ok(dashboard.servicePoints.length >= 1);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Cookie: cookiePair,
      },
      signal: AbortSignal.timeout(15_000),
    });

    assert.equal(logoutResponse.status, 200);
    assert.equal(logoutResponseSchema.parse(await logoutResponse.json()).success, true);
    assert.match(String(logoutResponse.headers.get('set-cookie')), /Path=\/api/i);

    const rejectedDashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: {
        Accept: 'application/json',
        Cookie: cookiePair,
      },
      signal: AbortSignal.timeout(15_000),
    });

    assert.equal(rejectedDashboardResponse.status, 401);
    assert.equal(
      authApiErrorSchema.parse(await rejectedDashboardResponse.json()).code,
      'AUTHENTICATION_REQUIRED',
    );

    console.log(`Admin authentication HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          adminId: loginBody.admin.id,
          courts: dashboard.servicePoints.length,
          logoutRevokedSession: true,
          username: loginBody.admin.username,
        },
        null,
        2,
      ),
    );
  } finally {
    if (createdTokenHash) {
      await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [createdTokenHash]);
    }

    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
