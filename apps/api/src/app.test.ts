import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOrderApiErrorSchema,
  createOrderResponseSchema,
  publicApiErrorSchema,
  publicServicePointContextSchema,
  type CreateOrderResponse,
  type PublicServicePointContext,
} from '@nhdp/contracts';

import { buildApp, type HealthResponse } from './app.js';
import { CreateOrderDomainError, type CreateOrderService } from './order/create-order-service.js';
import type { PublicContextRepository } from './public-context/public-context-repository.js';

const publicContextFixture: PublicServicePointContext = publicServicePointContextSchema.parse({
  venue: {
    id: '019f2bbb-797d-777f-947e-848374706128',
    slug: 'ngon-hai-dang-pickleball',
    name: 'Ngon Hải Đăng Pickleball',
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
  },
  servicePoint: {
    id: '019f2bbb-797d-777f-947e-848374706129',
    code: 'SAN-01',
    slug: 'san-01',
    name: 'Sân 01',
  },
  media: { cloudName: null },
  categories: [
    {
      id: '019f2bbb-797d-777f-947e-848374706130',
      slug: 'nuoc-uong',
      name: 'Nước uống',
      description: null,
      sortOrder: 0,
      items: [
        {
          id: '019f2bbb-797d-777f-947e-848374706131',
          slug: 'nuoc-suoi',
          name: 'Nước suối',
          description: null,
          unitName: 'chai',
          priceVnd: 10_000,
          sortOrder: 0,
          image: null,
        },
      ],
    },
  ],
  generatedAt: '2026-07-04T05:00:00.000Z',
});

const orderFixture: CreateOrderResponse = createOrderResponseSchema.parse({
  replayed: false,
  order: {
    id: '019f2bbb-797d-777f-947e-848374706140',
    status: 'PENDING',
    note: 'Ít đá',
    totalVnd: 20_000,
    createdAt: '2026-07-04T05:01:00.000Z',
  },
  bill: {
    id: '019f2bbb-797d-777f-947e-848374706141',
    status: 'OPEN',
    subtotalVnd: 20_000,
    totalVnd: 20_000,
  },
  lines: [
    {
      id: '019f2bbb-797d-777f-947e-848374706142',
      catalogItemId: '019f2bbb-797d-777f-947e-848374706131',
      itemName: 'Nước suối',
      unitName: 'chai',
      imagePublicId: null,
      unitPriceVnd: 10_000,
      quantity: 2,
      lineTotalVnd: 20_000,
      status: 'ACTIVE',
    },
  ],
});

function createContextRepository(): PublicContextRepository {
  return {
    findByServicePointSlug(slug) {
      return Promise.resolve(slug === 'san-01' ? publicContextFixture : null);
    },
  };
}

function createOrderServiceMock(
  implementation: CreateOrderService['create'] = () => Promise.resolve(orderFixture),
): CreateOrderService {
  return { create: implementation };
}

const validOrderBody = {
  idempotencyKey: '019f2bbb-797d-777f-947e-848374706150',
  note: 'Ít đá',
  items: [
    {
      catalogItemId: '019f2bbb-797d-777f-947e-848374706131',
      quantity: 2,
    },
  ],
};

void test('GET /health returns the API health contract', async (context) => {
  const app = buildApp({ logger: false });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);

  const body = response.json<HealthResponse>();

  assert.equal(body.status, 'ok');
  assert.equal(body.service, '@nhdp/api');
  assert.equal(body.version, '0.0.0');
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

void test('GET public context returns shared contract data', async (context) => {
  const app = buildApp({ logger: false }, { publicContextRepository: createContextRepository() });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/public/service-points/san-01/context',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');

  const body = publicServicePointContextSchema.parse(response.json());

  assert.equal(body.servicePoint.slug, 'san-01');
  assert.equal(body.categories[0]?.items[0]?.priceVnd, 10_000);
});

void test('GET public context returns typed 404 for unknown slug', async (context) => {
  const app = buildApp({ logger: false }, { publicContextRepository: createContextRepository() });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/public/service-points/khong-ton-tai/context',
  });

  assert.equal(response.statusCode, 404);

  const body = publicApiErrorSchema.parse(response.json());

  assert.equal(body.code, 'SERVICE_POINT_NOT_FOUND');
});

void test('POST order creates a typed order response', async (context) => {
  const app = buildApp({ logger: false }, { createOrderService: createOrderServiceMock() });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/public/service-points/san-01/orders',
    payload: validOrderBody,
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['cache-control'], 'no-store');

  const body = createOrderResponseSchema.parse(response.json());

  assert.equal(body.replayed, false);
  assert.equal(body.order.totalVnd, 20_000);
  assert.equal(body.lines[0]?.unitPriceVnd, 10_000);
});

void test('POST order replay returns HTTP 200', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      createOrderService: createOrderServiceMock(() =>
        Promise.resolve({ ...orderFixture, replayed: true }),
      ),
    },
  );

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/public/service-points/san-01/orders',
    payload: validOrderBody,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(createOrderResponseSchema.parse(response.json()).replayed, true);
});

void test('POST order rejects client supplied price', async (context) => {
  const app = buildApp({ logger: false }, { createOrderService: createOrderServiceMock() });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/public/service-points/san-01/orders',
    payload: {
      ...validOrderBody,
      items: [
        {
          catalogItemId: '019f2bbb-797d-777f-947e-848374706131',
          quantity: 2,
          unitPriceVnd: 1,
        },
      ],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(createOrderApiErrorSchema.parse(response.json()).code, 'INVALID_ORDER_REQUEST');
});

void test('POST order maps unavailable item to HTTP 409', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      createOrderService: createOrderServiceMock(() =>
        Promise.reject(
          new CreateOrderDomainError('CATALOG_ITEM_UNAVAILABLE', 'Món không còn khả dụng.'),
        ),
      ),
    },
  );

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/public/service-points/san-01/orders',
    payload: validOrderBody,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(createOrderApiErrorSchema.parse(response.json()).code, 'CATALOG_ITEM_UNAVAILABLE');
});

void test('unknown routes return 404', async (context) => {
  const app = buildApp({ logger: false });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/not-found',
  });

  assert.equal(response.statusCode, 404);
});
