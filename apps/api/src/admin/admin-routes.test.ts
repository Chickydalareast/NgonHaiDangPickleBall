import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminDashboardResponseSchema,
  authApiErrorSchema,
  authSessionResponseSchema,
  logoutResponseSchema,
  type AdminDashboardResponse,
  type AuthSessionResponse,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  InvalidCredentialsError,
  type AdminAuthService,
} from './admin-auth-service.js';
import type { AdminDashboardRepository } from './admin-dashboard-repository.js';

const rawToken = 'a'.repeat(43);

const sessionFixture: AuthSessionResponse = authSessionResponseSchema.parse({
  admin: {
    id: '019f2bbb-797d-777f-947e-848374706201',
    username: 'admin',
    displayName: 'Administrator',
    role: 'ADMIN',
  },
  expiresAt: '2026-07-05T12:00:00.000Z',
});

const dashboardFixture: AdminDashboardResponse = adminDashboardResponseSchema.parse({
  generatedAt: '2026-07-05T00:00:00.000Z',
  servicePoints: [
    {
      id: '019f2bbb-797d-777f-947e-848374706202',
      venueId: '019f2bbb-797d-777f-947e-848374706203',
      venueName: 'Ngon Hải Đăng Pickleball',
      code: 'COURT-01',
      slug: 'san-01',
      name: 'Sân 01',
      status: 'ACTIVE',
      openBill: {
        id: '019f2bbb-797d-777f-947e-848374706204',
        totalVnd: 120_000,
        openedAt: '2026-07-05T00:00:00.000Z',
      },
      pendingOrderCount: 2,
      hasPendingServiceRequest: true,
    },
  ],
});

function createAuthService(overrides: Partial<AdminAuthService> = {}): AdminAuthService {
  return {
    login: (request) =>
      Promise.resolve({
        rawToken,
        session: {
          ...sessionFixture,
          admin: {
            ...sessionFixture.admin,
            username: request.username,
          },
        },
      }),
    restore: (token) => Promise.resolve(token === rawToken ? sessionFixture : null),
    revoke: () => Promise.resolve(),
    ...overrides,
  };
}

function createDashboardRepository(): AdminDashboardRepository {
  return {
    read: () => Promise.resolve(dashboardFixture),
  };
}

void test('POST auth login returns session and HttpOnly cookie', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: createAuthService(), adminCookieSecure: false },
  );

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      username: 'ADMIN',
      password: 'correct-password',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(authSessionResponseSchema.parse(response.json()).admin.username, 'admin');

  const setCookie = response.headers['set-cookie'];

  if (typeof setCookie !== 'string') {
    throw new Error('Login response did not set a cookie.');
  }

  assert.match(setCookie, new RegExp(`^${ADMIN_SESSION_COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\/api/i);
  assert.doesNotMatch(setCookie, /; Secure/i);
});

void test('POST auth login maps invalid credentials to one typed error', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService({
        login: () => Promise.reject(new InvalidCredentialsError()),
      }),
    },
  );

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username: 'admin', password: 'wrong' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(authApiErrorSchema.parse(response.json()).code, 'INVALID_CREDENTIALS');
});

void test('POST auth login rejects unknown fields', async (context) => {
  const app = buildApp({ logger: false }, { adminAuthService: createAuthService() });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      username: 'admin',
      password: 'correct-password',
      email: 'admin@example.com',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(authApiErrorSchema.parse(response.json()).code, 'INVALID_AUTH_REQUEST');
});

void test('GET auth session requires a valid cookie', async (context) => {
  const app = buildApp({ logger: false }, { adminAuthService: createAuthService() });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
  });

  assert.equal(response.statusCode, 401);
  assert.equal(authApiErrorSchema.parse(response.json()).code, 'AUTHENTICATION_REQUIRED');
});

void test('GET auth session restores the safe admin identity', async (context) => {
  const app = buildApp({ logger: false }, { adminAuthService: createAuthService() });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}`,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(authSessionResponseSchema.parse(response.json()), sessionFixture);
});

void test('POST auth logout revokes the current session and clears cookie', async (context) => {
  let revokedToken: string | null = null;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService({
        revoke: (token) => {
          revokedToken = token;
          return Promise.resolve();
        },
      }),
    },
  );

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}`,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(logoutResponseSchema.parse(response.json()).success, true);
  assert.equal(revokedToken, rawToken);
  assert.match(String(response.headers['set-cookie']), /Path=\/api/i);
});

void test('GET admin dashboard rejects unauthenticated requests', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminDashboardRepository: createDashboardRepository(),
    },
  );

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/admin/dashboard',
  });

  assert.equal(response.statusCode, 401);
});

void test('GET admin dashboard returns the protected typed snapshot', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminDashboardRepository: createDashboardRepository(),
    },
  );

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/admin/dashboard',
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}`,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const dashboard = adminDashboardResponseSchema.parse(response.json());
  assert.equal(dashboard.servicePoints[0]?.pendingOrderCount, 2);
  assert.equal(dashboard.servicePoints[0]?.openBill?.totalVnd, 120_000);
});
