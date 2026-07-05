import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acknowledgeAdminAlertResponseSchema,
  adminAlertApiErrorSchema,
  adminAlertsResponseSchema,
  authSessionResponseSchema,
  type AuthSessionResponse,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import type { AdminAlertService } from './admin-alert-service.js';
import { AdminAlertDomainError } from './admin-alert-service.js';
import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from './admin-auth-service.js';

const rawToken = 'c'.repeat(43);
const adminId = '019f2bbb-797d-777f-947e-848374706601';
const orderId = '019f2bbb-797d-777f-947e-848374706602';
const requestId = '019f2bbb-797d-777f-947e-848374706603';
const servicePointId = '019f2bbb-797d-777f-947e-848374706604';

const sessionFixture: AuthSessionResponse = authSessionResponseSchema.parse({
  admin: {
    id: adminId,
    username: 'admin',
    displayName: 'Administrator',
    role: 'ADMIN',
  },
  expiresAt: '2099-07-05T12:00:00.000Z',
});

function createAuthService(): AdminAuthService {
  return {
    login: () => Promise.reject(new Error('Login is not used by this test.')),
    restore: (token) => Promise.resolve(token === rawToken ? sessionFixture : null),
    revoke: () => Promise.resolve(),
  };
}

function createAlertService(overrides: Partial<AdminAlertService> = {}): AdminAlertService {
  return {
    read: () =>
      Promise.resolve(
        adminAlertsResponseSchema.parse({
          generatedAt: '2026-07-05T10:00:00.000Z',
          alerts: [],
        }),
      ),
    acknowledgeOrder: ({ adminUserId, orderId: value }) =>
      Promise.resolve(
        acknowledgeAdminAlertResponseSchema.parse({
          kind: 'ORDER',
          entityId: value,
          servicePointId,
          acknowledgedAt: '2026-07-05T10:01:00.000Z',
          acknowledgedByAdminUserId: adminUserId,
          replayed: false,
        }),
      ),
    acknowledgeServiceRequest: ({ adminUserId, serviceRequestId }) =>
      Promise.resolve(
        acknowledgeAdminAlertResponseSchema.parse({
          kind: 'SERVICE_REQUEST',
          entityId: serviceRequestId,
          servicePointId,
          acknowledgedAt: '2026-07-05T10:01:00.000Z',
          acknowledgedByAdminUserId: adminUserId,
          replayed: false,
        }),
      ),
    ...overrides,
  };
}

void test('GET admin alerts requires authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminAlertService: createAlertService(),
    },
  );

  context.after(async () => app.close());

  const response = await app.inject({ method: 'GET', url: '/admin/alerts' });
  assert.equal(response.statusCode, 401);
});

void test('GET admin alerts returns typed active alerts', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminAlertService: createAlertService(),
    },
  );

  context.after(async () => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/admin/alerts',
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(adminAlertsResponseSchema.parse(response.json()).alerts, []);
});

void test('PATCH order alert acknowledge passes authenticated admin identity', async (context) => {
  let receivedAdminId: string | null = null;
  let receivedOrderId: string | null = null;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminAlertService: createAlertService({
        acknowledgeOrder(command) {
          receivedAdminId = command.adminUserId;
          receivedOrderId = command.orderId;
          return Promise.resolve(
            acknowledgeAdminAlertResponseSchema.parse({
              kind: 'ORDER',
              entityId: command.orderId,
              servicePointId,
              acknowledgedAt: '2026-07-05T10:01:00.000Z',
              acknowledgedByAdminUserId: command.adminUserId,
              replayed: false,
            }),
          );
        },
      }),
    },
  );

  context.after(async () => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/alerts/orders/${orderId}/acknowledge`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedAdminId, adminId);
  assert.equal(receivedOrderId, orderId);
  assert.equal(acknowledgeAdminAlertResponseSchema.parse(response.json()).kind, 'ORDER');
});

void test('PATCH service request alert acknowledge rejects request body', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminAlertService: createAlertService(),
    },
  );

  context.after(async () => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/alerts/service-requests/${requestId}/acknowledge`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {},
  });

  assert.equal(response.statusCode, 400);
  assert.equal(adminAlertApiErrorSchema.parse(response.json()).code, 'INVALID_ADMIN_ALERT_REQUEST');
});

void test('PATCH alert acknowledge maps inactive domain state to conflict', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminAlertService: createAlertService({
        acknowledgeServiceRequest: () =>
          Promise.reject(
            new AdminAlertDomainError('ADMIN_ALERT_NOT_ACTIVE', 'Yêu cầu không còn chờ.'),
          ),
      }),
    },
  );

  context.after(async () => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/alerts/service-requests/${requestId}/acknowledge`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(adminAlertApiErrorSchema.parse(response.json()).code, 'ADMIN_ALERT_NOT_ACTIVE');
});
