import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminDashboardResponseSchema,
  adminRealtimeEventSchema,
  authSessionResponseSchema,
  createPublicServiceRequestResponseSchema,
  readPendingServiceRequestResponseSchema,
  resolveAdminServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
  type AdminRealtimeEvent,
} from '../packages/contracts/dist/index.js';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { z } from 'zod';

const localEnvironment = existsSync('.env')
  ? parse(readFileSync('.env'))
  : parse(readFileSync('.env.example'));

const environmentSchema = z.object({
  ADMIN_SEED_PASSWORD: z.string().min(16).max(200),
  ADMIN_SEED_USERNAME: z.string().regex(/^[a-z0-9._-]{3,50}$/),
  CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
});
const environment = environmentSchema.parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

function hashToken(rawToken: string): string {
  return createHmac('sha256', environment.SESSION_SECRET).update(rawToken).digest('hex');
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 15_000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function createEventReader(response: Response) {
  if (!response.body) {
    throw new Error('SSE response did not provide a body stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async next(expectedType: AdminRealtimeEvent['type']): Promise<AdminRealtimeEvent> {
      while (true) {
        while (buffer.includes('\n\n')) {
          const boundary = buffer.indexOf('\n\n');
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = block.split('\n');
          const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7);
          const data = lines.find((line) => line.startsWith('data: '))?.slice(6);

          if (eventName === expectedType && data) {
            return adminRealtimeEventSchema.parse(JSON.parse(data) as unknown);
          }
        }

        const chunk = await reader.read();

        if (chunk.done) {
          throw new Error(`SSE connection closed before ${expectedType} was received.`);
        }

        buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
      }
    },
  };
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step9-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const servicePointSlug = `verify-call-staff-${suffix}`;
  const abortController = new AbortController();
  let servicePointId: string | null = null;
  let sessionTokenHash: string | null = null;

  try {
    const venue = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venues WHERE slug = 'ngon-hai-dang-pickleball' LIMIT 1`,
      )
    ).rows[0];
    assert.ok(venue);

    servicePointId =
      (
        await pool.query<{ id: string }>(
          `
          INSERT INTO service_points (venue_id, code, name, slug, status, sort_order)
          VALUES ($1, $2, $3, $4, 'ACTIVE', 9999)
          RETURNING id
        `,
          [venue.id, `CALL-${suffix}`, 'Sân kiểm thử gọi nhân viên', servicePointSlug],
        )
      ).rows[0]?.id ?? null;
    assert.ok(servicePointId);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: environment.ADMIN_SEED_USERNAME,
        password: environment.ADMIN_SEED_PASSWORD,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(loginResponse.status, 200);
    authSessionResponseSchema.parse(await loginResponse.json());
    const setCookie = loginResponse.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookiePair = setCookie.split(';')[0];
    assert.ok(cookiePair);
    sessionTokenHash = hashToken(cookiePair.slice(cookiePair.indexOf('=') + 1));

    const eventResponse = await fetch(`${baseUrl}/api/admin/events`, {
      headers: { Accept: 'text/event-stream', Cookie: cookiePair },
      signal: abortController.signal,
    });
    assert.equal(eventResponse.status, 200);
    const eventReader = createEventReader(eventResponse);

    const initialPendingResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/service-requests/pending`,
      { signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(initialPendingResponse.status, 200);
    assert.equal(
      readPendingServiceRequestResponseSchema.parse(await initialPendingResponse.json()).request,
      null,
    );

    const invalidResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/service-requests`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Cần hỗ trợ', priority: 'urgent' }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(invalidResponse.status, 400);
    assert.equal(
      serviceRequestApiErrorSchema.parse(await invalidResponse.json()).code,
      'INVALID_SERVICE_REQUEST',
    );

    const createdEventPromise = withTimeout(
      eventReader.next('service-request.created'),
      'Timed out waiting for service-request.created.',
    );
    const createResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/service-requests`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Cần nhân viên hỗ trợ tại sân' }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(createResponse.status, 201);
    const created = createPublicServiceRequestResponseSchema.parse(await createResponse.json());
    const createdEvent = await createdEventPromise;
    if (createdEvent.type !== 'service-request.created') {
      throw new Error(`Expected service-request.created, received ${createdEvent.type}.`);
    }
    assert.equal(createdEvent.servicePointId, servicePointId);
    assert.equal(createdEvent.serviceRequestId, created.request.id);

    const replayResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/service-requests`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(replayResponse.status, 200);
    const replay = createPublicServiceRequestResponseSchema.parse(await replayResponse.json());
    assert.equal(replay.replayed, true);
    assert.equal(replay.request.id, created.request.id);

    const dashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Accept: 'application/json', Cookie: cookiePair },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = adminDashboardResponseSchema.parse(await dashboardResponse.json());
    const court = dashboard.servicePoints.find((entry) => entry.id === servicePointId);
    assert.equal(court?.pendingServiceRequest?.id, created.request.id);

    const unauthorizedResolve = await fetch(
      `${baseUrl}/api/admin/service-requests/${created.request.id}/resolve`,
      { method: 'PATCH', signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(unauthorizedResolve.status, 401);

    const resolvedEventPromise = withTimeout(
      eventReader.next('service-request.resolved'),
      'Timed out waiting for service-request.resolved.',
    );
    const resolveResponse = await fetch(
      `${baseUrl}/api/admin/service-requests/${created.request.id}/resolve`,
      {
        method: 'PATCH',
        headers: { Accept: 'application/json', Cookie: cookiePair },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(resolveResponse.status, 200);
    const resolved = resolveAdminServiceRequestResponseSchema.parse(await resolveResponse.json());
    const resolvedEvent = await resolvedEventPromise;
    if (resolvedEvent.type !== 'service-request.resolved') {
      throw new Error(`Expected service-request.resolved, received ${resolvedEvent.type}.`);
    }
    assert.equal(resolvedEvent.serviceRequestId, resolved.id);

    const afterResolveResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/service-requests/pending`,
      { signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(afterResolveResponse.status, 200);
    assert.equal(
      readPendingServiceRequestResponseSchema.parse(await afterResolveResponse.json()).request,
      null,
    );

    const secondCreateResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/service-requests`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(secondCreateResponse.status, 201);
    const second = createPublicServiceRequestResponseSchema.parse(
      await secondCreateResponse.json(),
    );
    assert.notEqual(second.request.id, created.request.id);

    abortController.abort();

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Accept: 'application/json', Cookie: cookiePair },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(logoutResponse.status, 200);

    console.log(`Call staff HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          servicePointId,
          firstRequestId: created.request.id,
          duplicateReturnedSameRequest: replay.request.id === created.request.id,
          resolvedRequestId: resolved.id,
          newRequestAfterResolve: second.request.id !== created.request.id,
          realtimeEvents: [createdEvent.type, resolvedEvent.type],
        },
        null,
        2,
      ),
    );
  } finally {
    abortController.abort();

    if (sessionTokenHash) {
      await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [sessionTokenHash]);
    }

    if (servicePointId) {
      await pool.query(
        `
          DELETE FROM activity_logs
          WHERE entity_type = 'service_request'
            AND entity_id IN (
              SELECT id FROM service_requests WHERE service_point_id = $1
            )
        `,
        [servicePointId],
      );
      await pool.query(`DELETE FROM service_requests WHERE service_point_id = $1`, [
        servicePointId,
      ]);
      await pool.query(`DELETE FROM service_points WHERE id = $1`, [servicePointId]);
    }

    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
