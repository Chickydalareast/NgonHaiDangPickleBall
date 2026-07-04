import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminBillCompletionApiErrorSchema,
  adminBillDetailResponseSchema,
  adminDashboardResponseSchema,
  adminOrderOperationApiErrorSchema,
  adminRealtimeEventSchema,
  authSessionResponseSchema,
  completeAdminBillResponseSchema,
  createOrderResponseSchema,
} from '../packages/contracts/dist/index.js';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { z } from 'zod';

const localEnvironment = existsSync('.env')
  ? parse(readFileSync('.env'))
  : parse(readFileSync('.env.example'));

const environment = z
  .object({
    ADMIN_SEED_PASSWORD: z.string().min(16).max(200),
    ADMIN_SEED_USERNAME: z.string().regex(/^[a-z0-9._-]{3,50}$/),
    CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
  })
  .parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

async function jsonRequest(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(15_000),
  });
}

async function readNamedEvent(response: Response, expectedType: string): Promise<unknown> {
  if (!response.body) {
    throw new Error('SSE response did not provide a body stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      throw new Error(`SSE connection closed before ${expectedType} was received.`);
    }

    buffer += decoder.decode(chunk.value, { stream: true });

    while (buffer.includes('\n\n')) {
      const boundary = buffer.indexOf('\n\n');
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = block.split('\n');
      const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);

      if (eventName === expectedType && data) {
        return JSON.parse(data) as unknown;
      }
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step8-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const slug = `verify-completion-${suffix}`;
  const abortController = new AbortController();
  let streamTimeout: NodeJS.Timeout | null = null;
  let servicePointId: string | null = null;
  let tokenHash: string | null = null;

  try {
    const venue = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venues WHERE slug = 'ngon-hai-dang-pickleball' LIMIT 1`,
      )
    ).rows[0];
    const item = (
      await pool.query<{ id: string; price_vnd: number }>(
        `
          SELECT id, price_vnd
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE
          ORDER BY sort_order, id
          LIMIT 1
        `,
      )
    ).rows[0];
    assert.ok(venue);
    assert.ok(item);

    const servicePoint = (
      await pool.query<{ id: string }>(
        `
          INSERT INTO service_points (venue_id, code, name, slug, status, sort_order)
          VALUES ($1, $2, 'Sân kiểm thử completion', $3, 'ACTIVE', 9999)
          RETURNING id
        `,
        [venue.id, `CP-${suffix}`, slug],
      )
    ).rows[0];
    assert.ok(servicePoint);
    servicePointId = servicePoint.id;

    const loginResponse = await jsonRequest('/api/auth/login', {
      method: 'POST',
      body: {
        username: environment.ADMIN_SEED_USERNAME,
        password: environment.ADMIN_SEED_PASSWORD,
      },
    });
    assert.equal(loginResponse.status, 200);
    authSessionResponseSchema.parse(await loginResponse.json());
    const setCookie = loginResponse.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookie = setCookie.split(';')[0];
    assert.ok(cookie);
    const rawToken = cookie.slice(cookie.indexOf('=') + 1);
    tokenHash = createHmac('sha256', environment.SESSION_SECRET).update(rawToken).digest('hex');

    const createResponse = await jsonRequest(`/api/public/service-points/${slug}/orders`, {
      method: 'POST',
      body: {
        idempotencyKey: randomUUID(),
        note: 'Step 8 HTTP bill completion',
        items: [{ catalogItemId: item.id, quantity: 2 }],
      },
    });
    assert.equal(createResponse.status, 201);
    const firstOrder = createOrderResponseSchema.parse(await createResponse.json());

    const unauthorized = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}/complete`, {
      method: 'POST',
    });
    assert.equal(unauthorized.status, 401);

    const invalidBody = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}/complete`, {
      method: 'POST',
      cookie,
      body: { totalVnd: 1 },
    });
    assert.equal(invalidBody.status, 400);
    assert.equal(
      adminBillCompletionApiErrorSchema.parse(await invalidBody.json()).code,
      'INVALID_ADMIN_BILL_COMPLETION_REQUEST',
    );

    const blocked = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}/complete`, {
      method: 'POST',
      cookie,
    });
    assert.equal(blocked.status, 409);
    assert.equal(
      adminBillCompletionApiErrorSchema.parse(await blocked.json()).code,
      'BILL_HAS_UNRESOLVED_ORDERS',
    );

    streamTimeout = setTimeout(() => abortController.abort(), 25_000);
    const eventResponse = await fetch(`${baseUrl}/api/admin/events`, {
      headers: {
        Accept: 'text/event-stream',
        Cookie: cookie,
      },
      signal: abortController.signal,
    });
    assert.equal(eventResponse.status, 200);
    const eventPromise = readNamedEvent(eventResponse, 'bill.completed');

    const acceptResponse = await jsonRequest(`/api/admin/orders/${firstOrder.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'ACCEPTED' },
    });
    assert.equal(acceptResponse.status, 200);

    const serveResponse = await jsonRequest(`/api/admin/orders/${firstOrder.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'SERVED' },
    });
    assert.equal(serveResponse.status, 200);

    const completeResponse = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}/complete`, {
      method: 'POST',
      cookie,
    });
    assert.equal(completeResponse.status, 200);
    const completed = completeAdminBillResponseSchema.parse(await completeResponse.json());
    assert.equal(completed.totalVnd, item.price_vnd * 2);

    const completedEvent = adminRealtimeEventSchema.parse(
      await Promise.race([
        eventPromise,
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('Timed out waiting for bill.completed SSE event.')),
            15_000,
          );
        }),
      ]),
    );
    assert.deepEqual(completedEvent, {
      type: 'bill.completed',
      servicePointId,
      billId: firstOrder.bill.id,
    });

    if (streamTimeout) {
      clearTimeout(streamTimeout);
      streamTimeout = null;
    }
    abortController.abort();

    const detailResponse = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}`, {
      cookie,
    });
    assert.equal(detailResponse.status, 200);
    assert.equal(
      adminBillDetailResponseSchema.parse(await detailResponse.json()).bill.status,
      'COMPLETED',
    );

    const dashboardAfterCompletionResponse = await jsonRequest('/api/admin/dashboard', {
      cookie,
    });
    assert.equal(dashboardAfterCompletionResponse.status, 200);
    const dashboardAfterCompletion = adminDashboardResponseSchema.parse(
      await dashboardAfterCompletionResponse.json(),
    );
    const completedCourt = dashboardAfterCompletion.servicePoints.find(
      (entry) => entry.id === servicePointId,
    );
    assert.equal(completedCourt?.openBill, null);

    const lockedMutation = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}/items`, {
      method: 'POST',
      cookie,
      body: { catalogItemId: item.id, quantity: 1 },
    });
    assert.equal(lockedMutation.status, 409);
    assert.equal(
      adminOrderOperationApiErrorSchema.parse(await lockedMutation.json()).code,
      'ADMIN_BILL_NOT_OPEN',
    );

    const secondCreateResponse = await jsonRequest(`/api/public/service-points/${slug}/orders`, {
      method: 'POST',
      body: {
        idempotencyKey: randomUUID(),
        items: [{ catalogItemId: item.id, quantity: 1 }],
      },
    });
    assert.equal(secondCreateResponse.status, 201);
    const secondOrder = createOrderResponseSchema.parse(await secondCreateResponse.json());
    assert.notEqual(secondOrder.bill.id, firstOrder.bill.id);
    assert.equal(secondOrder.bill.status, 'OPEN');

    const dashboardAfterNewOrderResponse = await jsonRequest('/api/admin/dashboard', {
      cookie,
    });
    assert.equal(dashboardAfterNewOrderResponse.status, 200);
    const dashboardAfterNewOrder = adminDashboardResponseSchema.parse(
      await dashboardAfterNewOrderResponse.json(),
    );
    const reopenedCourt = dashboardAfterNewOrder.servicePoints.find(
      (entry) => entry.id === servicePointId,
    );
    assert.equal(reopenedCourt?.openBill?.id, secondOrder.bill.id);

    console.log(`Admin bill completion HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          completedBillId: firstOrder.bill.id,
          completedTotalVnd: completed.totalVnd,
          courtFreeAfterCompletion: completedCourt?.openBill === null,
          newBillId: secondOrder.bill.id,
          newBillCreated: secondOrder.bill.id !== firstOrder.bill.id,
          sseEventType: completedEvent.type,
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

    if (tokenHash) {
      await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [tokenHash]);
    }

    if (servicePointId) {
      await pool.query(
        `
          DELETE FROM activity_logs
          WHERE venue_id = (SELECT venue_id FROM service_points WHERE id = $1)
            AND (
              entity_id IN (SELECT id FROM bills WHERE service_point_id = $1)
              OR entity_id IN (SELECT id FROM orders WHERE service_point_id = $1)
              OR entity_id IN (
                SELECT order_lines.id
                FROM order_lines
                INNER JOIN orders ON orders.id = order_lines.order_id
                WHERE orders.service_point_id = $1
              )
            )
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
