import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminRealtimeEventSchema,
  authSessionResponseSchema,
  createOrderResponseSchema,
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

async function readOrderCreatedEvent(response: Response): Promise<unknown> {
  if (!response.body) {
    throw new Error('SSE response did not provide a body stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      throw new Error('SSE connection closed before order.created was received.');
    }

    buffer += decoder.decode(chunk.value, { stream: true });

    while (buffer.includes('\n\n')) {
      const boundary = buffer.indexOf('\n\n');
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = block.split('\n');
      const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);

      if (eventName === 'order.created' && data) {
        return JSON.parse(data) as unknown;
      }
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step6-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const servicePointSlug = `verify-realtime-${suffix}`;
  const abortController = new AbortController();
  let servicePointId: string | null = null;
  let sessionTokenHash: string | null = null;
  let streamTimeout: NodeJS.Timeout | null = null;

  try {
    const venueResult = await pool.query<{ id: string }>(
      `SELECT id FROM venues WHERE slug = 'ngon-hai-dang-pickleball' LIMIT 1`,
    );
    const itemResult = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM catalog_items
        WHERE status = 'ACTIVE' AND is_available = TRUE
        ORDER BY sort_order, id
        LIMIT 1
      `,
    );
    const venue = venueResult.rows[0];
    const item = itemResult.rows[0];

    assert.ok(venue);
    assert.ok(item);

    const servicePointResult = await pool.query<{ id: string }>(
      `
        INSERT INTO service_points (venue_id, code, name, slug, status, sort_order)
        VALUES ($1, $2, $3, $4, 'ACTIVE', 9999)
        RETURNING id
      `,
      [venue.id, `RT-${suffix}`, 'Sân kiểm thử realtime', servicePointSlug],
    );
    servicePointId = servicePointResult.rows[0]?.id ?? null;
    assert.ok(servicePointId);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
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
    const rawToken = cookiePair.slice(cookiePair.indexOf('=') + 1);
    sessionTokenHash = hashToken(rawToken);

    const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/events`, {
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(unauthorizedResponse.status, 401);

    streamTimeout = setTimeout(() => abortController.abort(), 20_000);
    const eventResponse = await fetch(`${baseUrl}/api/admin/events`, {
      headers: {
        Accept: 'text/event-stream',
        Cookie: cookiePair,
      },
      signal: abortController.signal,
    });

    assert.equal(eventResponse.status, 200);
    assert.match(eventResponse.headers.get('content-type') ?? '', /^text\/event-stream/i);
    assert.equal(eventResponse.headers.get('cache-control'), 'no-cache, no-transform');
    assert.equal(eventResponse.headers.get('x-accel-buffering'), 'no');

    const eventPromise = readOrderCreatedEvent(eventResponse);
    const idempotencyKey = randomUUID();
    const orderRequest = {
      idempotencyKey,
      note: 'HTTP Step 6 verification',
      items: [{ catalogItemId: item.id, quantity: 1 }],
    };
    const orderResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/orders`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderRequest),
        signal: AbortSignal.timeout(15_000),
      },
    );

    assert.equal(orderResponse.status, 201);
    const order = createOrderResponseSchema.parse(await orderResponse.json());
    const realtimeEvent = adminRealtimeEventSchema.parse(
      await Promise.race([
        eventPromise,
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('Timed out waiting for order.created SSE event.')),
            15_000,
          );
        }),
      ]),
    );

    if (streamTimeout) {
      clearTimeout(streamTimeout);
      streamTimeout = null;
    }

    assert.deepEqual(realtimeEvent, {
      type: 'order.created',
      servicePointId,
      billId: order.bill.id,
      orderId: order.order.id,
    });

    const replayResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/orders`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderRequest),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(replayResponse.status, 200);
    assert.equal(createOrderResponseSchema.parse(await replayResponse.json()).replayed, true);

    abortController.abort();

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Cookie: cookiePair,
      },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(logoutResponse.status, 200);

    console.log(`Admin realtime HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          eventType: realtimeEvent.type,
          orderId: realtimeEvent.orderId,
          servicePointId: realtimeEvent.servicePointId,
          sseAuthenticated: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (streamTimeout) {
      clearTimeout(streamTimeout);
    }

    abortController.abort();

    if (sessionTokenHash) {
      await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [sessionTokenHash]);
    }

    if (servicePointId) {
      await pool.query(
        `
          DELETE FROM activity_logs
          WHERE entity_type = 'order'
            AND entity_id IN (SELECT id FROM orders WHERE service_point_id = $1)
        `,
        [servicePointId],
      );
      await pool.query(
        `DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE service_point_id = $1)`,
        [servicePointId],
      );
      await pool.query(`DELETE FROM orders WHERE service_point_id = $1`, [servicePointId]);
      await pool.query(`DELETE FROM bills WHERE service_point_id = $1`, [servicePointId]);
      await pool.query(`DELETE FROM service_points WHERE id = $1`, [servicePointId]);
    }

    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
