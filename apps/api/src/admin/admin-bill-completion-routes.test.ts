import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminBillCompletionApiErrorSchema,
  completeAdminBillResponseSchema,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from './admin-auth-service.js';
import {
  AdminBillCompletionDomainError,
  type AdminBillCompletionService,
} from './admin-bill-completion-service.js';

const rawToken = 'a'.repeat(43);
const billId = '019f2bbb-797d-777f-947e-848374706401';
const servicePointId = '019f2bbb-797d-777f-947e-848374706402';
const adminUserId = '019f2bbb-797d-777f-947e-848374706403';

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

function completionService(
  overrides: Partial<AdminBillCompletionService> = {},
): AdminBillCompletionService {
  return {
    completeBill: () =>
      Promise.resolve({
        billId,
        servicePointId,
        status: 'COMPLETED',
        totalVnd: 60_000,
        completedAt: '2026-07-05T01:00:00.000Z',
      }),
    ...overrides,
  };
}

void test('POST complete bill requires authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminBillCompletionService: completionService(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/bills/${billId}/complete`,
  });

  assert.equal(response.statusCode, 401);
});

void test('POST complete bill passes safe admin identity and returns typed response', async (context) => {
  let capturedAdminUserId: string | null = null;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminBillCompletionService: completionService({
        completeBill(command) {
          capturedAdminUserId = command.adminUserId;
          return Promise.resolve({
            billId,
            servicePointId,
            status: 'COMPLETED',
            totalVnd: 60_000,
            completedAt: '2026-07-05T01:00:00.000Z',
          });
        },
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/bills/${billId}/complete`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedAdminUserId, adminUserId);
  assert.equal(completeAdminBillResponseSchema.parse(response.json()).status, 'COMPLETED');
});

void test('POST complete bill rejects request bodies', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminBillCompletionService: completionService(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/bills/${billId}/complete`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: { totalVnd: 1 },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    adminBillCompletionApiErrorSchema.parse(response.json()).code,
    'INVALID_ADMIN_BILL_COMPLETION_REQUEST',
  );
});

void test('POST complete bill maps unresolved orders to HTTP 409', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminBillCompletionService: completionService({
        completeBill: () =>
          Promise.reject(
            new AdminBillCompletionDomainError(
              'BILL_HAS_UNRESOLVED_ORDERS',
              'Bill còn order đang chờ hoặc chưa phục vụ.',
            ),
          ),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/bills/${billId}/complete`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    adminBillCompletionApiErrorSchema.parse(response.json()).code,
    'BILL_HAS_UNRESOLVED_ORDERS',
  );
});
