import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminRealtimeEventSchema,
  authSessionResponseSchema,
  type AuthSessionResponse,
} from '@nhdp/contracts';

import { buildApp } from '../app.js';
import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from './admin-auth-service.js';
import { createAdminRealtimeHub } from './admin-realtime-hub.js';

const rawToken = 'b'.repeat(43);
const sessionFixture: AuthSessionResponse = authSessionResponseSchema.parse({
  admin: {
    id: '019f2bbb-797d-777f-947e-848374706401',
    username: 'admin',
    displayName: 'Administrator',
    role: 'ADMIN',
  },
  expiresAt: '2099-07-05T12:00:00.000Z',
});

function createAuthService(): AdminAuthService {
  return {
    login: () => Promise.reject(new Error('Login is not used by this test.')),
    restore: (token) => Promise.resolve(token === rawToken ? sessionFixture : null),
    revoke: () => Promise.resolve(),
  };
}

async function readEvent(response: Response): Promise<unknown> {
  if (!response.body) {
    throw new Error('SSE response body is missing.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      throw new Error('SSE response ended before the event arrived.');
    }

    const value: unknown = chunk.value;

    if (!(value instanceof Uint8Array)) {
      throw new Error('SSE response returned a non-binary chunk.');
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes('\n\n')) {
      const boundary = buffer.indexOf('\n\n');
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6);

      if (data) {
        return JSON.parse(data) as unknown;
      }
    }
  }
}

void test('GET admin events streams a published order.created event', async (context) => {
  const hub = createAdminRealtimeHub();
  const app = buildApp(
    { logger: false },
    {
      adminAuthService: createAuthService(),
      adminRealtimeHub: hub,
    },
  );
  const abortController = new AbortController();

  context.after(async () => {
    abortController.abort();
    hub.close();
    await app.close();
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Fastify did not expose a TCP port.');
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/admin/events`, {
    headers: {
      Cookie: `${ADMIN_SESSION_COOKIE_NAME}=${rawToken}`,
    },
    signal: abortController.signal,
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/i);

  const eventPromise = readEvent(response);
  const event = adminRealtimeEventSchema.parse({
    type: 'order.created',
    servicePointId: '019f2bbb-797d-777f-947e-848374706402',
    billId: '019f2bbb-797d-777f-947e-848374706403',
    orderId: '019f2bbb-797d-777f-947e-848374706404',
  });

  hub.publish(event);

  assert.deepEqual(adminRealtimeEventSchema.parse(await eventPromise), event);
  abortController.abort();
});
