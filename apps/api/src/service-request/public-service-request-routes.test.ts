import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicServiceRequestResponseSchema,
  readPendingServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import {
  PublicServiceRequestDomainError,
  type PublicServiceRequestService,
} from './public-service-request-service.js';

const servicePointId = '019f2bbb-797d-777f-947e-848374706501';
const requestId = '019f2bbb-797d-777f-947e-848374706502';

const pendingRequest = {
  id: requestId,
  servicePointId,
  billId: null,
  status: 'PENDING' as const,
  message: 'Cần hỗ trợ tại sân',
  createdAt: '2026-07-05T12:00:00.000Z',
};

function service(
  overrides: Partial<PublicServiceRequestService> = {},
): PublicServiceRequestService {
  return {
    readPending: () => Promise.resolve({ request: pendingRequest }),
    create: () => Promise.resolve({ replayed: false, request: pendingRequest }),
    ...overrides,
  };
}

void test('GET pending service request returns typed state', async (context) => {
  const app = buildApp({ logger: false }, { publicServiceRequestService: service() });
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/public/service-points/san-01/service-requests/pending',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(
    readPendingServiceRequestResponseSchema.parse(response.json()).request,
    pendingRequest,
  );
});

void test('POST service request returns 201 for a new request', async (context) => {
  let receivedMessage: string | undefined;
  const app = buildApp(
    { logger: false },
    {
      publicServiceRequestService: service({
        create: (command) => {
          receivedMessage = command.request.message;
          return Promise.resolve({ replayed: false, request: pendingRequest });
        },
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/public/service-points/san-01/service-requests',
    payload: { message: '  Cần hỗ trợ tại sân  ' },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(receivedMessage, 'Cần hỗ trợ tại sân');
  assert.equal(createPublicServiceRequestResponseSchema.parse(response.json()).replayed, false);
});

void test('POST service request returns 200 when a pending request already exists', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      publicServiceRequestService: service({
        create: () => Promise.resolve({ replayed: true, request: pendingRequest }),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/public/service-points/san-01/service-requests',
    payload: {},
  });

  assert.equal(response.statusCode, 200);
  assert.equal(createPublicServiceRequestResponseSchema.parse(response.json()).replayed, true);
});

void test('public service request routes reject unknown fields', async (context) => {
  const app = buildApp({ logger: false }, { publicServiceRequestService: service() });
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/public/service-points/san-01/service-requests',
    payload: { message: 'Cần hỗ trợ', priority: 'urgent' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(serviceRequestApiErrorSchema.parse(response.json()).code, 'INVALID_SERVICE_REQUEST');
});

void test('public service request routes map inactive courts to 404', async (context) => {
  const app = buildApp(
    { logger: false },
    {
      publicServiceRequestService: service({
        readPending: () =>
          Promise.reject(
            new PublicServiceRequestDomainError(
              'SERVICE_POINT_NOT_FOUND',
              'Không tìm thấy sân hoặc sân hiện không hoạt động.',
            ),
          ),
      }),
    },
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/public/service-points/khong-ton-tai/service-requests/pending',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(serviceRequestApiErrorSchema.parse(response.json()).code, 'SERVICE_POINT_NOT_FOUND');
});
