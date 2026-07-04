import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  createOrderApiErrorSchema,
  createOrderResponseSchema,
} from '../packages/contracts/dist/index.js';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { z } from 'zod';

const localEnvironment = existsSync('.env')
  ? parse(readFileSync('.env'))
  : parse(readFileSync('.env.example'));

const environmentSchema = z.object({
  CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.string().min(1),
});
const environment = environmentSchema.parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step4-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const servicePointSlug = `verify-order-${suffix}`;
  let servicePointId: string | null = null;

  try {
    const venueResult = await pool.query<{ id: string }>(
      `SELECT id FROM venues WHERE slug = 'ngon-hai-dang-pickleball' LIMIT 1`,
    );
    const itemResult = await pool.query<{
      id: string;
      price_vnd: number;
    }>(
      `
        SELECT id, price_vnd
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
        INSERT INTO service_points (
          venue_id,
          code,
          name,
          slug,
          status,
          sort_order
        )
        VALUES ($1, $2, $3, $4, 'ACTIVE', 9999)
        RETURNING id
      `,
      [venue.id, `VERIFY-${suffix}`, 'Sân kiểm thử order', servicePointSlug],
    );
    servicePointId = servicePointResult.rows[0]?.id ?? null;
    assert.ok(servicePointId);

    const idempotencyKey = randomUUID();
    const requestBody = {
      idempotencyKey,
      note: 'HTTP Step 4 verification',
      items: [{ catalogItemId: item.id, quantity: 2 }],
    };
    const firstResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/orders`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15_000),
      },
    );

    assert.equal(firstResponse.status, 201);

    const firstOrder = createOrderResponseSchema.parse(await firstResponse.json());

    assert.equal(firstOrder.replayed, false);
    assert.equal(firstOrder.order.totalVnd, item.price_vnd * 2);
    assert.equal(firstOrder.lines[0]?.unitPriceVnd, item.price_vnd);

    const replayResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/orders`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15_000),
      },
    );

    assert.equal(replayResponse.status, 200);

    const replayedOrder = createOrderResponseSchema.parse(await replayResponse.json());

    assert.equal(replayedOrder.replayed, true);
    assert.equal(replayedOrder.order.id, firstOrder.order.id);

    const invalidResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/orders`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...requestBody,
          idempotencyKey: randomUUID(),
          items: [
            {
              catalogItemId: item.id,
              quantity: 1,
              unitPriceVnd: 1,
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    assert.equal(invalidResponse.status, 400);
    assert.equal(
      createOrderApiErrorSchema.parse(await invalidResponse.json()).code,
      'INVALID_ORDER_REQUEST',
    );

    const countsResult = await pool.query<{
      bills: number;
      orders: number;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::integer FROM bills WHERE service_point_id = $1) AS bills,
          (SELECT COUNT(*)::integer FROM orders WHERE service_point_id = $1) AS orders
      `,
      [servicePointId],
    );
    const counts = countsResult.rows[0];

    assert.ok(counts);
    assert.deepEqual(counts, { bills: 1, orders: 1 });

    console.log(`Create order HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          billId: firstOrder.bill.id,
          orderId: firstOrder.order.id,
          replayedOrderId: replayedOrder.order.id,
          totalVnd: firstOrder.order.totalVnd,
        },
        null,
        2,
      ),
    );
  } finally {
    if (servicePointId) {
      await pool.query(
        `
          DELETE FROM activity_logs
          WHERE entity_type = 'order'
            AND entity_id IN (
              SELECT id FROM orders WHERE service_point_id = $1
            )
        `,
        [servicePointId],
      );
      await pool.query(
        `
          DELETE FROM order_lines
          WHERE order_id IN (
            SELECT id FROM orders WHERE service_point_id = $1
          )
        `,
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
