import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminCatalogApiErrorSchema,
  adminCatalogResponseSchema,
  type AdminCatalogResponse,
} from '@nhdp/contracts';

import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from '../admin/admin-auth-service.js';
import { buildApp } from '../app.js';
import { AdminCatalogDomainError, type AdminCatalogService } from './admin-catalog-service.js';

const rawToken = 'a'.repeat(43);
const adminUserId = '019f2bbb-797d-777f-947e-848374706910';
const categoryId = '019f2bbb-797d-777f-947e-848374706911';
const itemId = '019f2bbb-797d-777f-947e-848374706912';

const catalogFixture: AdminCatalogResponse = adminCatalogResponseSchema.parse({
  generatedAt: '2026-07-05T02:00:00.000Z',
  venue: {
    id: '019f2bbb-797d-777f-947e-848374706913',
    name: 'Ngon Hải Đăng Pickleball',
  },
  media: { configured: false, cloudName: null },
  categories: [
    {
      id: categoryId,
      name: 'Nước uống',
      slug: 'nuoc-uong',
      description: null,
      status: 'ACTIVE',
      sortOrder: 10,
      createdAt: '2026-07-05T02:00:00.000Z',
      updatedAt: '2026-07-05T02:00:00.000Z',
      items: [
        {
          id: itemId,
          categoryId,
          name: 'Nước suối',
          slug: 'nuoc-suoi',
          description: null,
          unitName: 'chai',
          priceVnd: 10_000,
          status: 'ACTIVE',
          isAvailable: true,
          sortOrder: 10,
          image: null,
          createdAt: '2026-07-05T02:00:00.000Z',
          updatedAt: '2026-07-05T02:00:00.000Z',
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

function catalogService(overrides: Partial<AdminCatalogService> = {}): AdminCatalogService {
  return {
    getCatalog: () => Promise.resolve(catalogFixture),
    createCategory: () => Promise.resolve(catalogFixture),
    updateCategory: () => Promise.resolve(catalogFixture),
    createItem: () => Promise.resolve(catalogFixture),
    updateItem: () => Promise.resolve(catalogFixture),
    createImageUploadSignature: () =>
      Promise.reject(
        new AdminCatalogDomainError(
          'ADMIN_CATALOG_IMAGE_NOT_CONFIGURED',
          'Cloudinary chưa được cấu hình trên máy chủ.',
        ),
      ),
    attachImage: () => Promise.resolve(catalogFixture),
    removeImage: () => Promise.resolve(catalogFixture),
    ...overrides,
  };
}

void test('GET admin catalog requires authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminCatalogService: catalogService() },
  );
  context.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/admin/catalog' });
  assert.equal(response.statusCode, 401);
});

void test('GET admin catalog returns the shared contract', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminCatalogService: catalogService() },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/admin/catalog',
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(adminCatalogResponseSchema.parse(response.json()).categories[0]?.items.length, 1);
});

void test('catalog mutation rejects unknown fields', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminCatalogService: catalogService() },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/admin/catalog/categories',
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: {
      name: 'Đồ ăn',
      slug: 'do-an',
      description: null,
      status: 'ACTIVE',
      sortOrder: 10,
      stockQuantity: 99,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    adminCatalogApiErrorSchema.parse(response.json()).code,
    'INVALID_ADMIN_CATALOG_REQUEST',
  );
});

void test('image signature returns typed 503 when Cloudinary is not configured', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminCatalogService: catalogService() },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/admin/catalog/items/${itemId}/image-signature`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(
    adminCatalogApiErrorSchema.parse(response.json()).code,
    'ADMIN_CATALOG_IMAGE_NOT_CONFIGURED',
  );
});
