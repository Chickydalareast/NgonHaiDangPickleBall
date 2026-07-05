import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminBillCompletionApiErrorSchema,
  adminBillDetailResponseSchema,
  adminOrderOperationApiErrorSchema,
  adminServicePointsResponseSchema,
  adminSettlementApiErrorSchema,
  authSessionResponseSchema,
  completeAdminBillResponseSchema,
  createOrderResponseSchema,
  publicCurrentBillResponseSchema,
  publicServicePointContextSchema,
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
  })
  .parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

function cookiePair(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('Admin login did not return a session cookie.');
  return header.split(';', 1)[0] ?? '';
}

async function requestJson(
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
}

async function main(): Promise<void> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step10pro-d-http-verifier',
  });

  let servicePointId: string | undefined;
  let billId: string | undefined;
  let cookie = '';

  try {
    const loginResponse = await requestJson('/api/auth/login', {
      method: 'POST',
      body: {
        username: environment.ADMIN_SEED_USERNAME,
        password: environment.ADMIN_SEED_PASSWORD,
      },
    });
    assert.equal(loginResponse.status, 200);
    authSessionResponseSchema.parse(await loginResponse.clone().json());
    cookie = cookiePair(loginResponse);

    const courtResponse = await requestJson('/api/admin/service-points', {
      method: 'POST',
      cookie,
      body: {
        code: `SETTLE-${suffix.toUpperCase()}`,
        name: 'Sân verify settlement',
        slug: `verify-settle-${suffix}`,
        status: 'ACTIVE',
        sortOrder: 999_500,
      },
    });
    assert.equal(courtResponse.status, 200);
    const courts = adminServicePointsResponseSchema.parse(await courtResponse.json());
    const court = courts.servicePoints.find((entry) => entry.slug === `verify-settle-${suffix}`);
    assert.ok(court);
    servicePointId = court.id;

    const contextResponse = await requestJson(`/api/public/service-points/${court.slug}/context`);
    assert.equal(contextResponse.status, 200);
    const context = publicServicePointContextSchema.parse(await contextResponse.json());
    const item = context.categories
      .flatMap((category) => category.items)
      .find((entry) => entry.priceVnd > 0);
    assert.ok(item);

    const orderResponse = await requestJson(`/api/public/service-points/${court.slug}/orders`, {
      method: 'POST',
      body: {
        idempotencyKey: randomUUID(),
        items: [{ catalogItemId: item.id, quantity: 5 }],
      },
    });
    assert.equal(orderResponse.status, 201);
    const created = createOrderResponseSchema.parse(await orderResponse.json());
    billId = created.bill.id;

    const acceptResponse = await requestJson(`/api/admin/orders/${created.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'ACCEPTED' },
    });
    assert.equal(acceptResponse.status, 200);
    let detail = adminBillDetailResponseSchema.parse(await acceptResponse.json());
    const line = detail.orders
      .flatMap((order) => order.lines)
      .find((entry) => entry.catalogItemId === item.id);
    assert.ok(line);

    const paidKey = randomUUID();
    const paidResponse = await requestJson(`/api/admin/order-lines/${line.id}/settlements`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: paidKey,
        type: 'PAID',
        quantity: 2,
      },
    });
    assert.equal(paidResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await paidResponse.json());
    assert.equal(detail.summary.paidTotalVnd, item.priceVnd * 2);
    assert.equal(detail.summary.outstandingTotalVnd, item.priceVnd * 3);
    const paidSettlement = detail.orders
      .flatMap((order) => order.lines)
      .find((entry) => entry.id === line.id)
      ?.settlements.find((entry) => entry.type === 'PAID');
    assert.ok(paidSettlement);

    const replayResponse = await requestJson(`/api/admin/order-lines/${line.id}/settlements`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: paidKey,
        type: 'PAID',
        quantity: 2,
      },
    });
    assert.equal(replayResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await replayResponse.json());
    assert.equal(
      detail.orders
        .flatMap((order) => order.lines)
        .find((entry) => entry.id === line.id)
        ?.settlements.filter((entry) => entry.type === 'PAID').length,
      1,
    );

    const waivedResponse = await requestJson(`/api/admin/order-lines/${line.id}/settlements`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: randomUUID(),
        type: 'WAIVED',
        quantity: 1,
        reason: 'Khuyến mãi kiểm thử HTTP',
      },
    });
    assert.equal(waivedResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await waivedResponse.json());
    assert.equal(detail.summary.waivedTotalVnd, item.priceVnd);
    assert.equal(detail.summary.outstandingTotalVnd, item.priceVnd * 2);
    const waivedSettlement = detail.orders
      .flatMap((order) => order.lines)
      .find((entry) => entry.id === line.id)
      ?.settlements.find((entry) => entry.type === 'WAIVED');
    assert.ok(waivedSettlement);

    const overResponse = await requestJson(`/api/admin/order-lines/${line.id}/settlements`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: randomUUID(),
        type: 'PAID',
        quantity: 3,
      },
    });
    assert.equal(overResponse.status, 409);
    assert.equal(
      adminSettlementApiErrorSchema.parse(await overResponse.json()).code,
      'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING',
    );

    const editBlocked = await requestJson(`/api/admin/order-lines/${line.id}`, {
      method: 'PATCH',
      cookie,
      body: { quantity: 6 },
    });
    assert.equal(editBlocked.status, 409);
    assert.equal(
      adminOrderOperationApiErrorSchema.parse(await editBlocked.json()).code,
      'ORDER_LINE_HAS_ACTIVE_SETTLEMENTS',
    );

    const voidBlocked = await requestJson(`/api/admin/order-lines/${line.id}/void`, {
      method: 'POST',
      cookie,
      body: { reason: 'Thử void line đã settlement' },
    });
    assert.equal(voidBlocked.status, 409);
    assert.equal(
      adminOrderOperationApiErrorSchema.parse(await voidBlocked.json()).code,
      'ORDER_LINE_HAS_ACTIVE_SETTLEMENTS',
    );

    const cancelBlocked = await requestJson(`/api/admin/orders/${created.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'CANCELLED', reason: 'Thử hủy order đã settlement' },
    });
    assert.equal(cancelBlocked.status, 409);
    assert.equal(
      adminOrderOperationApiErrorSchema.parse(await cancelBlocked.json()).code,
      'ORDER_HAS_ACTIVE_SETTLEMENTS',
    );

    const publicResponse = await requestJson(`/api/public/service-points/${court.slug}/bill`);
    assert.equal(publicResponse.status, 200);
    const publicBill = publicCurrentBillResponseSchema.parse(await publicResponse.json());
    assert.deepEqual(publicBill.summary, detail.summary);

    const reversePaidKey = randomUUID();
    const reversePaid = await requestJson(`/api/admin/settlements/${paidSettlement.id}/reverse`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: reversePaidKey,
        reason: 'Ghi nhận thanh toán nhầm',
      },
    });
    assert.equal(reversePaid.status, 200);
    detail = adminBillDetailResponseSchema.parse(await reversePaid.json());
    assert.equal(detail.summary.paidTotalVnd, 0);
    assert.equal(detail.summary.outstandingTotalVnd, item.priceVnd * 4);

    const reverseReplay = await requestJson(`/api/admin/settlements/${paidSettlement.id}/reverse`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: reversePaidKey,
        reason: 'Ghi nhận thanh toán nhầm',
      },
    });
    assert.equal(reverseReplay.status, 200);

    const reverseWaived = await requestJson(
      `/api/admin/settlements/${waivedSettlement.id}/reverse`,
      {
        method: 'POST',
        cookie,
        body: {
          idempotencyKey: randomUUID(),
          reason: 'Hủy miễn phí kiểm thử',
        },
      },
    );
    assert.equal(reverseWaived.status, 200);

    const editResponse = await requestJson(`/api/admin/order-lines/${line.id}`, {
      method: 'PATCH',
      cookie,
      body: { quantity: 6 },
    });
    assert.equal(editResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await editResponse.json());
    assert.equal(
      detail.orders.flatMap((order) => order.lines).find((entry) => entry.id === line.id)?.quantity,
      6,
    );

    const partialAgain = await requestJson(`/api/admin/order-lines/${line.id}/settlements`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: randomUUID(),
        type: 'PAID',
        quantity: 2,
      },
    });
    assert.equal(partialAgain.status, 200);
    detail = adminBillDetailResponseSchema.parse(await partialAgain.json());

    const serveResponse = await requestJson(`/api/admin/orders/${created.order.id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'SERVED' },
    });
    assert.equal(serveResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await serveResponse.json());

    const incompleteResponse = await requestJson(`/api/admin/bills/${billId}/complete`, {
      method: 'POST',
      cookie,
      body: { revision: detail.bill.updatedAt },
    });
    assert.equal(incompleteResponse.status, 409);
    assert.equal(
      adminBillCompletionApiErrorSchema.parse(await incompleteResponse.json()).code,
      'BILL_HAS_OUTSTANDING_SETTLEMENTS',
    );

    const finalPaid = await requestJson(`/api/admin/order-lines/${line.id}/settlements`, {
      method: 'POST',
      cookie,
      body: {
        idempotencyKey: randomUUID(),
        type: 'PAID',
        quantity: 4,
      },
    });
    assert.equal(finalPaid.status, 200);
    detail = adminBillDetailResponseSchema.parse(await finalPaid.json());
    assert.equal(detail.summary.outstandingTotalVnd, 0);
    assert.equal(detail.summary.items[0]?.outstandingQuantity, 0);

    const completeResponse = await requestJson(`/api/admin/bills/${billId}/complete`, {
      method: 'POST',
      cookie,
      body: { revision: detail.bill.updatedAt },
    });
    assert.equal(completeResponse.status, 200);
    completeAdminBillResponseSchema.parse(await completeResponse.json());

    const logoutResponse = await requestJson('/api/auth/logout', {
      method: 'POST',
      cookie,
    });
    assert.equal(logoutResponse.status, 200);

    console.log(`Partial settlement HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          partialPaidQuantity: 2,
          partialWaivedQuantity: 1,
          overAllocationRejected: true,
          createIdempotencyVerified: true,
          reversalIdempotencyVerified: true,
          settledLineMutationBlocked: true,
          publicAndAdminSummaryMatch: true,
          incompleteCompletionBlocked: true,
          completedAfterFullAllocation: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (billId) {
      const settlementResult = await pool.query<{ id: string }>(
        `SELECT id FROM order_line_settlements WHERE bill_id = $1`,
        [billId],
      );
      const orderResult = await pool.query<{ id: string }>(
        `SELECT id FROM orders WHERE bill_id = $1`,
        [billId],
      );
      const lineResult = await pool.query<{ id: string }>(
        `SELECT id FROM order_lines WHERE bill_id = $1`,
        [billId],
      );
      const entityIds = [
        billId,
        ...settlementResult.rows.map((row) => row.id),
        ...orderResult.rows.map((row) => row.id),
        ...lineResult.rows.map((row) => row.id),
      ];

      await pool.query(
        `
          DELETE FROM activity_logs
          WHERE entity_id = ANY($1::uuid[])
             OR metadata->>'billId' = $2
        `,
        [entityIds, billId],
      );
      await pool.query(`DELETE FROM order_line_settlements WHERE bill_id = $1`, [billId]);
      await pool.query(`DELETE FROM order_lines WHERE bill_id = $1`, [billId]);
      await pool.query(`DELETE FROM orders WHERE bill_id = $1`, [billId]);
      await pool.query(`DELETE FROM bills WHERE id = $1`, [billId]);
    }

    if (servicePointId) {
      await pool.query(`DELETE FROM activity_logs WHERE entity_id = $1`, [servicePointId]);
      await pool.query(`DELETE FROM service_points WHERE id = $1`, [servicePointId]);
    }

    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
