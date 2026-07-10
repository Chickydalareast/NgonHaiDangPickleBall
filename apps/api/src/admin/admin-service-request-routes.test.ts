import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAdminServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from './admin-auth-service.js';
import {
  AdminServiceRequestDomainError,
  type AdminServiceRequestService,
} from './admin-service-request-service.js';

const rawToken = 'a'.repeat(43);
const adminUserId = '019f2bbb-797d-777f-947e-848374706601';
const requestId = '019f2bbb-797d-777f-947e-848374706602';
const servicePointId = '019f2bbb-797d-777f-947e-848374706603';

function authService(): AdminAuthService {
  return {
    login: () => Promise.reject(new Error('Not used')),
    restore: (token) =>
      Promise.resolve(
        token === rawToken
          ? {
              admin: {
                id: adminUserId,
                username: 'admin',
                displayName: 'Administrator',
                role: 'ADMIN',
              },
              expiresAt: '2026-07-05T12:00:00.000Z',
            }
          : null,
      ),
    revoke: () => Promise.resolve(),
  };
}

function service(overrides: Partial<AdminServiceRequestService> = {}): AdminServiceRequestService {
  return {
    resolve: () =>
      Promise.resolve({
        id: requestId,
        servicePointId,
        status: 'RESOLVED',
        resolvedAt: '2026-07-05T12:05:00.000Z',
      }),
    ...overrides,
  };
}

void test('PATCH resolve service request requires authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminServiceRequestService: service(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/service-requests/${requestId}/resolve`,
  });

  assert.equal(response.statusCode, 401);
});

void test('PATCH resolve service request passes safe admin identity', async (context) => {
  let receivedAdminUserId: string | null = null;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminServiceRequestService: service({
        resolve: (command) => {
          receivedAdminUserId = command.adminUserId;
          return Promise.resolve({
            id: requestId,
            servicePointId,
            status: 'RESOLVED',
            resolvedAt: '2026-07-05T12:05:00.000Z',
          });
        },
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/service-requests/${requestId}/resolve`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedAdminUserId, adminUserId);
  assert.equal(resolveAdminServiceRequestResponseSchema.parse(response.json()).status, 'RESOLVED');
});

void test('PATCH resolve service request rejects request bodies', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminServiceRequestService: service(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/service-requests/${requestId}/resolve`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: { reason: 'done' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    serviceRequestApiErrorSchema.parse(response.json()).code,
    'INVALID_ADMIN_SERVICE_REQUEST',
  );
});

void test('PATCH resolve service request maps non-pending state to 409', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminServiceRequestService: service({
        resolve: () =>
          Promise.reject(
            new AdminServiceRequestDomainError(
              'ADMIN_SERVICE_REQUEST_NOT_PENDING',
              'Yêu cầu hỗ trợ không còn ở trạng thái chờ.',
            ),
          ),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/service-requests/${requestId}/resolve`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    serviceRequestApiErrorSchema.parse(response.json()).code,
    'ADMIN_SERVICE_REQUEST_NOT_PENDING',
  );
});

void test('PATCH resolve accepts canonical JSON null', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminServiceRequestService: service(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/service-requests/${requestId}/resolve`,
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}`,
      'content-type': 'application/json',
    },
    payload: 'null',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(resolveAdminServiceRequestResponseSchema.parse(response.json()).status, 'RESOLVED');
});

void test('PATCH resolve accepts compatible foreign media type only for null', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminServiceRequestService: service(),
    },
  );
  context.after(() => app.close());

  const accepted = await app.inject({
    method: 'PATCH',
    url: `/admin/service-requests/${requestId}/resolve`,
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}`,
      'content-type': 'application/x-nhdp-empty-action',
    },
    payload: 'null',
  });

  assert.equal(accepted.statusCode, 200);

  const rejected = await app.inject({
    method: 'PATCH',
    url: `/admin/service-requests/${requestId}/resolve`,
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}`,
      'content-type': 'application/x-nhdp-empty-action',
    },
    payload: '{"reason":"unexpected"}',
  });

  assert.equal(rejected.statusCode, 400);
  assert.equal(
    serviceRequestApiErrorSchema.parse(rejected.json()).code,
    'INVALID_ADMIN_SERVICE_REQUEST',
  );
});
