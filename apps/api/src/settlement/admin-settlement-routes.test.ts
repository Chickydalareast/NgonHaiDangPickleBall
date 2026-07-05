import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  adminBillDetailResponseSchema,
  adminSettlementApiErrorSchema,
  type AdminBillDetailResponse,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from '../admin/admin-auth-service.js';
import {
  AdminSettlementDomainError,
  type AdminSettlementService,
} from './admin-settlement-service.js';

const rawToken = 'a'.repeat(43);
const adminId = '019f2bbb-797d-777f-947e-848374706701';
const lineId = '019f2bbb-797d-777f-947e-848374706702';
const settlementId = '019f2bbb-797d-777f-947e-848374706703';

const detailFixture: AdminBillDetailResponse = adminBillDetailResponseSchema.parse({
  generatedAt: '2026-07-05T00:00:00.000Z',
  venue: {
    id: '019f2bbb-797d-777f-947e-848374706704',
    name: 'Ngon Hải Đăng Pickleball',
  },
  servicePoint: {
    id: '019f2bbb-797d-777f-947e-848374706705',
    code: 'COURT-01',
    name: 'Sân 01',
    slug: 'san-01',
  },
  bill: {
    id: '019f2bbb-797d-777f-947e-848374706706',
    status: 'OPEN',
    subtotalVnd: 0,
    totalVnd: 0,
    openedAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  },
  summary: {
    grossTotalVnd: 0,
    paidTotalVnd: 0,
    waivedTotalVnd: 0,
    outstandingTotalVnd: 0,
    items: [],
  },
  orders: [],
});

function authService(): AdminAuthService {
  return {
    login: () => Promise.reject(new Error('Not used')),
    restore: (token) =>
      Promise.resolve(
        token === rawToken
          ? {
              admin: {
                id: adminId,
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

function service(overrides: Partial<AdminSettlementService> = {}): AdminSettlementService {
  return {
    create: () => Promise.resolve(detailFixture),
    reverse: () => Promise.resolve(detailFixture),
    ...overrides,
  };
}

void test('settlement routes require authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminSettlementService: service(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/order-lines/${lineId}/settlements`,
    payload: {
      idempotencyKey: randomUUID(),
      type: 'PAID',
      quantity: 1,
    },
  });

  assert.equal(response.statusCode, 401);
});

void test('POST settlement passes normalized request and admin identity', async (context) => {
  let captured: Parameters<AdminSettlementService['create']>[0] | undefined;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminSettlementService: service({
        create: (command) => {
          captured = command;
          return Promise.resolve(detailFixture);
        },
      }),
    },
  );
  context.after(() => app.close());

  const idempotencyKey = randomUUID();
  const response = await app.inject({
    method: 'POST',
    url: `/admin/order-lines/${lineId}/settlements`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      idempotencyKey,
      type: 'WAIVED',
      quantity: 2,
      reason: '  Khuyến mãi sân  ',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(captured, {
    adminUserId: adminId,
    lineId,
    request: {
      idempotencyKey,
      type: 'WAIVED',
      quantity: 2,
      reason: 'Khuyến mãi sân',
    },
  });
  adminBillDetailResponseSchema.parse(response.json());
});

void test('POST reverse settlement passes reason and idempotency key', async (context) => {
  let captured: Parameters<AdminSettlementService['reverse']>[0] | undefined;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminSettlementService: service({
        reverse: (command) => {
          captured = command;
          return Promise.resolve(detailFixture);
        },
      }),
    },
  );
  context.after(() => app.close());

  const idempotencyKey = randomUUID();
  const response = await app.inject({
    method: 'POST',
    url: `/admin/settlements/${settlementId}/reverse`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      idempotencyKey,
      reason: '  Ghi nhận nhầm  ',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(captured, {
    adminUserId: adminId,
    settlementId,
    request: {
      idempotencyKey,
      reason: 'Ghi nhận nhầm',
    },
  });
});

void test('settlement routes reject unknown financial fields', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminSettlementService: service(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/order-lines/${lineId}/settlements`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      idempotencyKey: randomUUID(),
      type: 'PAID',
      quantity: 1,
      amountVnd: 1,
    },
  });

  assert.equal(response.statusCode, 400);
  const parsed = adminSettlementApiErrorSchema.parse(response.json());
  assert.equal(parsed.code, 'INVALID_ADMIN_SETTLEMENT_REQUEST');
});

void test('settlement domain conflicts map to HTTP 409', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminSettlementService: service({
        create: () =>
          Promise.reject(
            new AdminSettlementDomainError(
              'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING',
              'Vượt số lượng.',
            ),
          ),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/order-lines/${lineId}/settlements`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      idempotencyKey: randomUUID(),
      type: 'PAID',
      quantity: 2,
    },
  });

  assert.equal(response.statusCode, 409);
  const parsed = adminSettlementApiErrorSchema.parse(response.json());
  assert.equal(parsed.code, 'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING');
});
