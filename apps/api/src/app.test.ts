import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicApiErrorSchema,
  publicServicePointContextSchema,
  type PublicServicePointContext,
} from '@nhdp/contracts';

import { buildApp, type HealthResponse } from './app.js';
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

function createRepository(): PublicContextRepository {
  return {
    findByServicePointSlug(slug) {
      return Promise.resolve(slug === 'san-01' ? publicContextFixture : null);
    },
  };
}

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
  const app = buildApp({ logger: false }, { publicContextRepository: createRepository() });

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
  const app = buildApp({ logger: false }, { publicContextRepository: createRepository() });

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
