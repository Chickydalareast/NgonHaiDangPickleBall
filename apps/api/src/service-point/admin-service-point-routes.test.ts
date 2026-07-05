import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminServicePointsApiErrorSchema,
  adminServicePointsResponseSchema,
  type AdminServicePointsResponse,
} from '@nhdp/contracts';

import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from '../admin/admin-auth-service.js';
import { buildApp } from '../app.js';
import {
  AdminServicePointDomainError,
  type AdminServicePointService,
} from './admin-service-point-service.js';

const rawToken = 'a'.repeat(43);
const adminUserId = '019f2bbb-797d-777f-947e-848374706910';
const servicePointId = '019f2bbb-797d-777f-947e-848374706911';

const fixture: AdminServicePointsResponse = adminServicePointsResponseSchema.parse({
  generatedAt: '2026-07-05T02:00:00.000Z',
  publicOrigin: 'http://localhost:8080',
  venue: {
    id: '019f2bbb-797d-777f-947e-848374706912',
    name: 'Ngon Hải Đăng Pickleball',
  },
  servicePoints: [
    {
      id: servicePointId,
      venueId: '019f2bbb-797d-777f-947e-848374706912',
      code: 'COURT-01',
      name: 'Sân 01',
      slug: 'san-01',
      status: 'ACTIVE',
      sortOrder: 10,
      customerUrl: 'http://localhost:8080/s/san-01',
      createdAt: '2026-07-05T02:00:00.000Z',
      updatedAt: '2026-07-05T02:00:00.000Z',
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

function service(overrides: Partial<AdminServicePointService> = {}): AdminServicePointService {
  return {
    getServicePoints: () => Promise.resolve(fixture),
    createServicePoint: () => Promise.resolve(fixture),
    updateServicePoint: () => Promise.resolve(fixture),
    createQrAsset: () =>
      Promise.resolve({
        manifestEntry: {
          servicePointId,
          code: 'COURT-01',
          name: 'Sân 01',
          slug: 'san-01',
          status: 'ACTIVE',
          targetUrl: 'http://localhost:8080/s/san-01',
          svgFileName: 'san-01-qr.svg',
          pngFileName: 'san-01-qr.png',
        },
        png: Buffer.from([137, 80, 78, 71]),
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      }),
    createActiveQrPack: () =>
      Promise.resolve({
        manifest: {
          generatedAt: '2026-07-05T02:00:00.000Z',
          publicOrigin: 'http://localhost:8080',
          servicePoints: [],
        },
        zip: Buffer.from('zip'),
      }),
    ...overrides,
  };
}

void test('GET admin service points requires authentication', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminServicePointService: service() },
  );
  context.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/admin/service-points' });
  assert.equal(response.statusCode, 401);
});

void test('GET admin service points returns shared contract', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminServicePointService: service() },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/admin/service-points',
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(adminServicePointsResponseSchema.parse(response.json()).servicePoints.length, 1);
});

void test('service point mutation rejects unknown fields and slug updates', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminServicePointService: service() },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/service-points/${servicePointId}`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: { slug: 'san-moi' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    adminServicePointsApiErrorSchema.parse(response.json()).code,
    'INVALID_ADMIN_SERVICE_POINT_REQUEST',
  );
});

void test('service point QR endpoints return binary content types', async (context) => {
  const app = buildApp(
    { logger: false },
    { adminAuthService: authService(), adminServicePointService: service() },
  );
  context.after(() => app.close());
  const headers = { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` };

  const [svgResponse, pngResponse, zipResponse] = await Promise.all([
    app.inject({ method: 'GET', url: `/admin/service-points/${servicePointId}/qr.svg`, headers }),
    app.inject({ method: 'GET', url: `/admin/service-points/${servicePointId}/qr.png`, headers }),
    app.inject({ method: 'GET', url: '/admin/service-points/qr-pack.zip', headers }),
  ]);

  assert.equal(svgResponse.statusCode, 200);
  assert.match(svgResponse.headers['content-type'] ?? '', /^image\/svg\+xml/);
  assert.equal(pngResponse.statusCode, 200);
  assert.match(pngResponse.headers['content-type'] ?? '', /^image\/png/);
  assert.equal(zipResponse.statusCode, 200);
  assert.match(zipResponse.headers['content-type'] ?? '', /^application\/zip/);
});

void test('deactivation conflict maps to typed HTTP 409', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: authService(),
      adminServicePointService: service({
        updateServicePoint: () =>
          Promise.reject(
            new AdminServicePointDomainError(
              'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_OPEN_BILL',
              'Không thể tắt sân khi vẫn còn bill đang mở.',
            ),
          ),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/admin/service-points/${servicePointId}`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}` },
    payload: { status: 'INACTIVE' },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    adminServicePointsApiErrorSchema.parse(response.json()).code,
    'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_OPEN_BILL',
  );
});
