import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  adminBillDetailResponseSchema,
  adminCustomChargeApiErrorSchema,
  type AdminBillDetailResponse,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from '../admin/admin-auth-service.js';
import {
  AdminCustomChargeDomainError,
  type AdminCustomChargeService,
} from './admin-custom-charge-service.js';

const rawToken = 'a'.repeat(43);
const billId = '019f2bbb-797d-777f-947e-848374706401';
const chargeId = '019f2bbb-797d-777f-947e-848374706402';
const orderId = '019f2bbb-797d-777f-947e-848374706403';

const detailFixture: AdminBillDetailResponse = adminBillDetailResponseSchema.parse({
  generatedAt: '2026-07-05T00:00:00.000Z',
  venue: {
    id: '019f2bbb-797d-777f-947e-848374706404',
    name: 'Ngon Hải Đăng Pickleball',
  },
  servicePoint: {
    id: '019f2bbb-797d-777f-947e-848374706405',
    code: 'COURT-01',
    name: 'Sân 01',
    slug: 'san-01',
  },
  bill: {
    id: billId,
    status: 'OPEN',
    subtotalVnd: 60_000,
    totalVnd: 60_000,
    openedAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  },
  summary: {
    grossTotalVnd: 60_000,
    paidTotalVnd: 0,
    waivedTotalVnd: 0,
    outstandingTotalVnd: 60_000,
    items: [
      {
        lineKind: 'MANUAL_TIME',
        catalogItemId: null,
        itemName: 'Thuê vợt',
        unitName: '30 phút',
        imagePublicId: null,
        unitPriceVnd: 20_000,
        orderedQuantity: 3,
        paidQuantity: 0,
        waivedQuantity: 0,
        outstandingQuantity: 3,
        grossTotalVnd: 60_000,
        paidTotalVnd: 0,
        waivedTotalVnd: 0,
        outstandingTotalVnd: 60_000,
        sourceOrderIds: [orderId],
        sourceLineIds: [chargeId],
        firstOrderedAt: '2026-07-05T00:00:00.000Z',
      },
    ],
  },
  orders: [
    {
      id: orderId,
      source: 'ADMIN',
      status: 'ACCEPTED',
      note: null,
      totalVnd: 60_000,
      acceptedAt: '2026-07-05T00:00:00.000Z',
      servedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      lines: [
        {
          id: chargeId,
          lineKind: 'MANUAL_TIME',
          catalogItemId: null,
          itemName: 'Thuê vợt',
          unitName: '30 phút',
          imagePublicId: null,
          unitPriceVnd: 20_000,
          quantity: 3,
          durationMinutes: 90,
          billingIntervalMinutes: 30,
          lineTotalVnd: 60_000,
          paidQuantity: 0,
          waivedQuantity: 0,
          outstandingQuantity: 3,
          paidTotalVnd: 0,
          waivedTotalVnd: 0,
          outstandingTotalVnd: 60_000,
          settlements: [],
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
                id: '019f2bbb-797d-777f-947e-848374706406',
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

function service(overrides: Partial<AdminCustomChargeService> = {}): AdminCustomChargeService {
  return {
    create: () => Promise.resolve(detailFixture),
    update: () => Promise.resolve(detailFixture),
    void: () => Promise.resolve(detailFixture),
    ...overrides,
  };
}

void test('custom charge routes require authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminCustomChargeService: service(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/bills/${billId}/custom-charges`,
    payload: {
      kind: 'MANUAL_PRODUCT',
      idempotencyKey: randomUUID(),
      name: 'Phí phát sinh',
      unitName: 'Khoản',
      quantity: 1,
      unitPriceVnd: 20_000,
    },
  });

  assert.equal(response.statusCode, 401);
});

void test('POST manual time charge passes normalized typed request', async (context) => {
  let capturedAdminId: string | null = null;
  let capturedKind: string | null = null;
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminCustomChargeService: service({
        create(command) {
          capturedAdminId = command.adminUserId;
          capturedKind = command.request.kind;
          return Promise.resolve(detailFixture);
        },
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/bills/${billId}/custom-charges`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      kind: 'MANUAL_TIME',
      idempotencyKey: randomUUID(),
      name: '  Thuê vợt  ',
      durationMinutes: 90,
      billingIntervalMinutes: 30,
      pricePerIntervalVnd: 20_000,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedAdminId, '019f2bbb-797d-777f-947e-848374706406');
  assert.equal(capturedKind, 'MANUAL_TIME');
  adminBillDetailResponseSchema.parse(response.json());
});

void test('custom charge routes reject unknown financial fields', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminCustomChargeService: service(),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/custom-charges/${chargeId}`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      kind: 'MANUAL_PRODUCT',
      name: 'Phí phát sinh',
      unitName: 'Khoản',
      quantity: 1,
      unitPriceVnd: 20_000,
      lineTotalVnd: 1,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    adminCustomChargeApiErrorSchema.parse(response.json()).code,
    'INVALID_ADMIN_CUSTOM_CHARGE_REQUEST',
  );
});

void test('custom charge conflicts map to typed HTTP 409', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminCustomChargeService: service({
        update: () =>
          Promise.reject(
            new AdminCustomChargeDomainError(
              'CUSTOM_CHARGE_KIND_IMMUTABLE',
              'Không thể đổi loại khoản phát sinh sau khi tạo.',
            ),
          ),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/custom-charges/${chargeId}`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      kind: 'MANUAL_PRODUCT',
      name: 'Phí phát sinh',
      unitName: 'Khoản',
      quantity: 1,
      unitPriceVnd: 20_000,
    },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    adminCustomChargeApiErrorSchema.parse(response.json()).code,
    'CUSTOM_CHARGE_KIND_IMMUTABLE',
  );
});
