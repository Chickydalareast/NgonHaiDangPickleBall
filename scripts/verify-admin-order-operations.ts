import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminBillDetailResponseSchema,
  adminOrderOperationApiErrorSchema,
  authSessionResponseSchema,
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

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step7-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const slug = `verify-operations-${suffix}`;
  let servicePointId: string | null = null;
  let tokenHash: string | null = null;

  try {
    const venue = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venues WHERE slug = 'ngon-hai-dang-pickleball' LIMIT 1`,
      )
    ).rows[0];
    const items = (
      await pool.query<{ id: string; price_vnd: number }>(
        `
          SELECT id, price_vnd
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE
          ORDER BY sort_order, id
          LIMIT 2
        `,
      )
    ).rows;
    assert.ok(venue);
    assert.ok(items[0]);
    const secondItem = items[1] ?? items[0];

    const servicePoint = (
      await pool.query<{ id: string }>(
        `
          INSERT INTO service_points (venue_id, code, name, slug, status, sort_order)
          VALUES ($1, $2, 'Sân kiểm thử operations', $3, 'ACTIVE', 9999)
          RETURNING id
        `,
        [venue.id, `OP-${suffix}`, slug],
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

    const firstCreateResponse = await jsonRequest(`/api/public/service-points/${slug}/orders`, {
      method: 'POST',
      body: {
        idempotencyKey: randomUUID(),
        note: 'Step 7 HTTP first order',
        items: [{ catalogItemId: items[0].id, quantity: 2 }],
      },
    });
    assert.equal(firstCreateResponse.status, 201);
    const firstOrder = createOrderResponseSchema.parse(await firstCreateResponse.json());

    const unauthorized = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}`);
    assert.equal(unauthorized.status, 401);

    const detailResponse = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}`, {
      cookie,
    });
    assert.equal(detailResponse.status, 200);
    let detail = adminBillDetailResponseSchema.parse(await detailResponse.json());
    const firstLine = detail.orders[0]?.lines[0];
    assert.ok(firstLine);

    const invalidLineResponse = await jsonRequest(`/api/admin/order-lines/${firstLine.id}`, {
      method: 'PATCH',
      cookie,
      body: { quantity: 3, unitPriceVnd: 1 },
    });
    assert.equal(invalidLineResponse.status, 400);
    assert.equal(
      adminOrderOperationApiErrorSchema.parse(await invalidLineResponse.json()).code,
      'INVALID_ADMIN_OPERATION_REQUEST',
    );

    const quantityResponse = await jsonRequest(`/api/admin/order-lines/${firstLine.id}`, {
      method: 'PATCH',
      cookie,
      body: { quantity: 3 },
    });
    assert.equal(quantityResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await quantityResponse.json());
    assert.equal(detail.orders[0]?.lines[0]?.quantity, 3);

    const acceptResponse = await jsonRequest(`/api/admin/orders/${firstOrder.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'ACCEPTED' },
    });
    assert.equal(acceptResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await acceptResponse.json());
    assert.equal(detail.orders[0]?.status, 'ACCEPTED');

    const serveResponse = await jsonRequest(`/api/admin/orders/${firstOrder.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'SERVED' },
    });
    assert.equal(serveResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await serveResponse.json());
    assert.equal(detail.orders[0]?.status, 'SERVED');

    const voidResponse = await jsonRequest(`/api/admin/order-lines/${firstLine.id}/void`, {
      method: 'POST',
      cookie,
      body: { reason: 'Khách không dùng món' },
    });
    assert.equal(voidResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await voidResponse.json());
    assert.equal(detail.orders[0]?.lines[0]?.status, 'VOIDED');
    assert.equal(detail.bill.totalVnd, 0);

    const addResponse = await jsonRequest(`/api/admin/bills/${firstOrder.bill.id}/items`, {
      method: 'POST',
      cookie,
      body: { catalogItemId: secondItem.id, quantity: 2 },
    });
    assert.equal(addResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await addResponse.json());
    assert.ok(detail.orders.some((order) => order.source === 'ADMIN'));
    assert.equal(detail.bill.totalVnd, secondItem.price_vnd * 2);

    const secondCreateResponse = await jsonRequest(`/api/public/service-points/${slug}/orders`, {
      method: 'POST',
      body: {
        idempotencyKey: randomUUID(),
        items: [{ catalogItemId: items[0].id, quantity: 1 }],
      },
    });
    assert.equal(secondCreateResponse.status, 201);
    const secondOrder = createOrderResponseSchema.parse(await secondCreateResponse.json());

    const cancelResponse = await jsonRequest(`/api/admin/orders/${secondOrder.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'CANCELLED', reason: 'Khách đổi ý' },
    });
    assert.equal(cancelResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await cancelResponse.json());
    const cancelled = detail.orders.find((order) => order.id === secondOrder.order.id);
    assert.equal(cancelled?.status, 'CANCELLED');
    assert.ok(cancelled?.lines.every((line) => line.status === 'VOIDED'));
    assert.equal(detail.bill.totalVnd, secondItem.price_vnd * 2);

    console.log(`Admin order operations HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          billId: firstOrder.bill.id,
          finalBillTotalVnd: detail.bill.totalVnd,
          manualOrderCreated: true,
          orderAcceptedAndServed: true,
          orderCancelledAndVoided: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (tokenHash) {
      await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [tokenHash]);
    }

    if (servicePointId) {
      await pool.query(
        `
          DELETE FROM activity_logs
          WHERE venue_id = (SELECT venue_id FROM service_points WHERE id = $1)
            AND (
              entity_id IN (SELECT id FROM orders WHERE service_point_id = $1)
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
