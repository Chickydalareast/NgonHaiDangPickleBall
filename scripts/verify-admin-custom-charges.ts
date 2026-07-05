import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminBillDetailResponseSchema,
  adminCustomChargeApiErrorSchema,
  adminServicePointsResponseSchema,
  authSessionResponseSchema,
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

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step10pro-c-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let servicePointId: string | null = null;
  let billId: string | null = null;

  try {
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
    authSessionResponseSchema.parse(await loginResponse.clone().json());
    const cookie = cookiePair(loginResponse);

    const createCourtResponse = await fetch(`${baseUrl}/api/admin/service-points`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        code: `CHARGE-${suffix.toUpperCase()}`,
        name: 'Sân verify custom charges',
        slug: `verify-charge-${suffix}`,
        status: 'ACTIVE',
        sortOrder: 999_600,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(createCourtResponse.status, 200);
    const courts = adminServicePointsResponseSchema.parse(await createCourtResponse.json());
    const court = courts.servicePoints.find((entry) => entry.slug === `verify-charge-${suffix}`);
    assert.ok(court);
    servicePointId = court.id;

    const contextResponse = await fetch(
      `${baseUrl}/api/public/service-points/${court.slug}/context`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(contextResponse.status, 200);
    const context = publicServicePointContextSchema.parse(await contextResponse.json());
    const item = context.categories.flatMap((category) => category.items)[0];
    assert.ok(item);

    const orderResponse = await fetch(`${baseUrl}/api/public/service-points/${court.slug}/orders`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        items: [{ catalogItemId: item.id, quantity: 1 }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(orderResponse.status, 201);
    const initialOrder = createOrderResponseSchema.parse(await orderResponse.json());
    billId = initialOrder.bill.id;

    const productKey = randomUUID();
    const productPayload = {
      kind: 'MANUAL_PRODUCT',
      idempotencyKey: productKey,
      name: 'Phí khăn thuê',
      unitName: 'Cái',
      quantity: 2,
      unitPriceVnd: 15_000,
    } as const;
    const productResponse = await fetch(`${baseUrl}/api/admin/bills/${billId}/custom-charges`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify(productPayload),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(productResponse.status, 200);
    let detail = adminBillDetailResponseSchema.parse(await productResponse.json());
    const productLine = detail.orders
      .flatMap((order) => order.lines)
      .find((line) => line.lineKind === 'MANUAL_PRODUCT');
    assert.ok(productLine);
    assert.equal(productLine.catalogItemId, null);
    assert.equal(productLine.lineTotalVnd, 30_000);

    const replayResponse = await fetch(`${baseUrl}/api/admin/bills/${billId}/custom-charges`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify(productPayload),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(replayResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await replayResponse.json());
    assert.equal(
      detail.orders
        .flatMap((order) => order.lines)
        .filter((line) => line.lineKind === 'MANUAL_PRODUCT').length,
      1,
    );

    const conflictResponse = await fetch(`${baseUrl}/api/admin/bills/${billId}/custom-charges`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        ...productPayload,
        name: 'Khoản khác',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(conflictResponse.status, 409);
    assert.equal(
      adminCustomChargeApiErrorSchema.parse(await conflictResponse.json()).code,
      'CUSTOM_CHARGE_IDEMPOTENCY_CONFLICT',
    );

    const timeResponse = await fetch(`${baseUrl}/api/admin/bills/${billId}/custom-charges`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        kind: 'MANUAL_TIME',
        idempotencyKey: randomUUID(),
        name: 'Thuê vợt',
        durationMinutes: 75,
        billingIntervalMinutes: 30,
        pricePerIntervalVnd: 20_000,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(timeResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await timeResponse.json());
    const timeLine = detail.orders
      .flatMap((order) => order.lines)
      .find((line) => line.lineKind === 'MANUAL_TIME');
    assert.ok(timeLine);
    assert.equal(timeLine.quantity, 3);
    assert.equal(timeLine.durationMinutes, 75);
    assert.equal(timeLine.billingIntervalMinutes, 30);
    assert.equal(timeLine.lineTotalVnd, 60_000);

    const updateResponse = await fetch(`${baseUrl}/api/admin/custom-charges/${productLine.id}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        kind: 'MANUAL_PRODUCT',
        name: 'Phí khăn thuê',
        unitName: 'Cái',
        quantity: 3,
        unitPriceVnd: 10_000,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(updateResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await updateResponse.json());
    assert.equal(
      detail.orders.flatMap((order) => order.lines).find((line) => line.id === productLine.id)
        ?.quantity,
      3,
    );

    const kindChangeResponse = await fetch(
      `${baseUrl}/api/admin/custom-charges/${productLine.id}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          kind: 'MANUAL_TIME',
          name: 'Phí khăn thuê',
          durationMinutes: 30,
          billingIntervalMinutes: 30,
          pricePerIntervalVnd: 10_000,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(kindChangeResponse.status, 409);

    const voidResponse = await fetch(`${baseUrl}/api/admin/custom-charges/${timeLine.id}/void`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({ reason: 'Khách không sử dụng dịch vụ thuê' }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(voidResponse.status, 200);
    detail = adminBillDetailResponseSchema.parse(await voidResponse.json());
    assert.equal(
      detail.orders.flatMap((order) => order.lines).find((line) => line.id === timeLine.id)?.status,
      'VOIDED',
    );
    assert.equal(
      detail.summary.items.some((entry) => entry.lineKind === 'MANUAL_TIME'),
      false,
    );

    const publicResponse = await fetch(`${baseUrl}/api/public/service-points/${court.slug}/bill`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(publicResponse.status, 200);
    const publicBill = publicCurrentBillResponseSchema.parse(await publicResponse.json());
    assert.deepEqual(publicBill.summary, detail.summary);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(logoutResponse.status, 200);

    console.log(`Admin custom charges HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          manualProductCreated: true,
          manualTimeCreated: true,
          timeChargeBillableIntervals: timeLine.quantity,
          idempotentReplayPreventedDuplicate: true,
          idempotencyConflictRejected: true,
          kindImmutable: true,
          voidExcludedFromSummary: true,
          publicAndAdminSummaryMatch: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (billId) {
      const orderResult = await pool.query<{ id: string }>(
        `SELECT id FROM orders WHERE bill_id = $1`,
        [billId],
      );
      const orderIds = orderResult.rows.map((row) => row.id);
      const lineResult = await pool.query<{ id: string }>(
        `SELECT id FROM order_lines WHERE bill_id = $1`,
        [billId],
      );
      const lineIds = lineResult.rows.map((row) => row.id);
      const entityIds = [...orderIds, ...lineIds];
      if (entityIds.length > 0) {
        await pool.query(`DELETE FROM activity_logs WHERE entity_id = ANY($1::uuid[])`, [
          entityIds,
        ]);
      }
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
