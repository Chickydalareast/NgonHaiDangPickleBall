import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminBillDetailResponseSchema,
  adminOrderOperationApiErrorSchema,
  type AdminBillDetailResponse,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from './admin-auth-service.js';
import {
  AdminOrderOperationDomainError,
  type AdminOrderOperationsService,
} from './admin-order-operations-service.js';

const rawToken = 'a'.repeat(43);
const billId = '019f2bbb-797d-777f-947e-848374706301';
const orderId = '019f2bbb-797d-777f-947e-848374706302';
const lineId = '019f2bbb-797d-777f-947e-848374706303';

const detailFixture: AdminBillDetailResponse = adminBillDetailResponseSchema.parse({
  generatedAt: '2026-07-05T00:00:00.000Z',
  venue: {
    id: '019f2bbb-797d-777f-947e-848374706304',
    name: 'Ngon Hải Đăng Pickleball',
  },
  servicePoint: {
    id: '019f2bbb-797d-777f-947e-848374706305',
    code: 'COURT-01',
    name: 'Sân 01',
    slug: 'san-01',
  },
  bill: {
    id: billId,
    status: 'OPEN',
    subtotalVnd: 20_000,
    totalVnd: 20_000,
    openedAt: '2026-07-05T00:00:00.000Z',
  },
  orders: [
    {
      id: orderId,
      source: 'CUSTOMER',
      status: 'PENDING',
      note: null,
      totalVnd: 20_000,
      acceptedAt: null,
      servedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      lines: [
        {
          id: lineId,
          catalogItemId: '019f2bbb-797d-777f-947e-848374706306',
          itemName: 'Nước suối',
          unitName: 'Chai',
          imagePublicId: null,
          unitPriceVnd: 10_000,
          quantity: 2,
          lineTotalVnd: 20_000,
          status: 'ACTIVE',
          voidReason: null,
          voidedAt: null,
          createdAt: '2026-07-05T00:00:00.000Z',
        },
      ],
    },
  ],
});

function authService(): AdminAuthService {
  return {
    login: () => Promise.reject(new Error('Not used')),
    restore: (token) =>
      Promise.resolve(
        token === rawToken
          ? {
              admin: {
                id: '019f2bbb-797d-777f-947e-848374706307',
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

function operationsService(
  overrides: Partial<AdminOrderOperationsService> = {},
): AdminOrderOperationsService {
  return {
    readBill: () => Promise.resolve(detailFixture),
    updateOrderStatus: () => Promise.resolve(detailFixture),
    addBillItem: () => Promise.resolve(detailFixture),
    updateOrderLine: () => Promise.resolve(detailFixture),
    voidOrderLine: () => Promise.resolve(detailFixture),
    ...overrides,
  };
}

void test('admin order operation routes require authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminOrderOperationsService: operationsService(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: `/admin/bills/${billId}` });
  assert.equal(response.statusCode, 401);
});

void test('GET admin bill returns typed detail', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminOrderOperationsService: operationsService(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: `/admin/bills/${billId}`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(adminBillDetailResponseSchema.parse(response.json()).bill.id, billId);
});

void test('PATCH order status passes safe admin identity to service', async (context) => {
  let capturedAdminUserId: string | null = null;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminOrderOperationsService: operationsService({
        updateOrderStatus(command) {
          capturedAdminUserId = command.adminUserId;
          return Promise.resolve(detailFixture);
        },
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/orders/${orderId}/status`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: { status: 'ACCEPTED' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedAdminUserId, '019f2bbb-797d-777f-947e-848374706307');
});

void test('admin order operation routes reject unknown fields', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminOrderOperationsService: operationsService(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/order-lines/${lineId}`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: { quantity: 2, unitPriceVnd: 1 },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    adminOrderOperationApiErrorSchema.parse(response.json()).code,
    'INVALID_ADMIN_OPERATION_REQUEST',
  );
});

void test('domain conflicts map to typed HTTP 409', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminOrderOperationsService: operationsService({
        voidOrderLine: () =>
          Promise.reject(
            new AdminOrderOperationDomainError(
              'ORDER_LINE_ALREADY_VOIDED',
              'Order line đã được void trước đó.',
            ),
          ),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/order-lines/${lineId}/void`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: { reason: 'Khách đổi món' },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    adminOrderOperationApiErrorSchema.parse(response.json()).code,
    'ORDER_LINE_ALREADY_VOIDED',
  );
});
