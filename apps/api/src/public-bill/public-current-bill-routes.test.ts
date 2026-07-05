import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicCurrentBillApiErrorSchema,
  publicCurrentBillResponseSchema,
  type PublicCurrentBillResponse,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import {
  PublicCurrentBillDomainError,
  type PublicCurrentBillService,
} from './public-current-bill-service.js';

const fixture: PublicCurrentBillResponse = publicCurrentBillResponseSchema.parse({
  generatedAt: '2026-07-05T00:00:00.000Z',
  venue: {
    id: '019f2bbb-797d-777f-947e-848374706601',
    name: 'Ngon Hải Đăng Pickleball',
    currency: 'VND',
  },
  servicePoint: {
    id: '019f2bbb-797d-777f-947e-848374706602',
    code: 'COURT-01',
    name: 'Sân 01',
    slug: 'san-01',
  },
  bill: {
    id: '019f2bbb-797d-777f-947e-848374706603',
    status: 'OPEN',
    openedAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:01:00.000Z',
  },
  summary: {
    grossTotalVnd: 50_000,
    paidTotalVnd: 0,
    waivedTotalVnd: 0,
    outstandingTotalVnd: 50_000,
    items: [
      {
        lineKind: 'CATALOG',
        catalogItemId: '019f2bbb-797d-777f-947e-848374706604',
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 10_000,
        orderedQuantity: 5,
        paidQuantity: 0,
        waivedQuantity: 0,
        outstandingQuantity: 5,
        grossTotalVnd: 50_000,
        paidTotalVnd: 0,
        waivedTotalVnd: 0,
        outstandingTotalVnd: 50_000,
        sourceOrderIds: [
          '019f2bbb-797d-777f-947e-848374706605',
          '019f2bbb-797d-777f-947e-848374706606',
        ],
        sourceLineIds: [
          '019f2bbb-797d-777f-947e-848374706607',
          '019f2bbb-797d-777f-947e-848374706608',
        ],
        firstOrderedAt: '2026-07-05T00:00:00.000Z',
      },
    ],
  },
  orders: [],
});

function service(read: PublicCurrentBillService['read']): PublicCurrentBillService {
  return { read };
}

void test('GET public current bill returns typed no-store response', async (context) => {
  const app = buildApp(
    { logger: false },
    { publicCurrentBillService: service(() => Promise.resolve(fixture)) },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/public/service-points/san-01/bill',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const parsed = publicCurrentBillResponseSchema.parse(response.json());
  assert.equal(parsed.summary.items[0]?.orderedQuantity, 5);
});

void test('GET public current bill maps inactive or unknown court to 404', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      publicCurrentBillService: service(() =>
        Promise.reject(
          new PublicCurrentBillDomainError(
            'SERVICE_POINT_NOT_FOUND',
            'Không tìm thấy sân đang hoạt động.',
          ),
        ),
      ),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/public/service-points/san-99/bill',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(
    publicCurrentBillApiErrorSchema.parse(response.json()).code,
    'SERVICE_POINT_NOT_FOUND',
  );
});

void test('GET public current bill rejects invalid slugs', async (context) => {
  const app = buildApp(
    { logger: false },
    { publicCurrentBillService: service(() => Promise.resolve(fixture)) },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/public/service-points/INVALID_SLUG/bill',
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    publicCurrentBillApiErrorSchema.parse(response.json()).code,
    'INVALID_PUBLIC_BILL_REQUEST',
  );
});
