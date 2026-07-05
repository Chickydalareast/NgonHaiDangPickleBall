import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminBillDetailResponseSchema,
  adminDashboardResponseSchema,
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
    application_name: 'nhdp-step10pro-b-http-verifier',
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
        code: `BILL-${suffix.toUpperCase()}`,
        name: 'Sân verify provisional bill',
        slug: `verify-bill-${suffix}`,
        status: 'ACTIVE',
        sortOrder: 999_700,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(createCourtResponse.status, 200);
    const courts = adminServicePointsResponseSchema.parse(await createCourtResponse.json());
    const court = courts.servicePoints.find((entry) => entry.slug === `verify-bill-${suffix}`);
    assert.ok(court);
    servicePointId = court.id;

    const emptyResponse = await fetch(`${baseUrl}/api/public/service-points/${court.slug}/bill`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(emptyResponse.status, 200);
    assert.equal(emptyResponse.headers.get('cache-control'), 'no-store');
    const empty = publicCurrentBillResponseSchema.parse(await emptyResponse.json());
    assert.equal(empty.bill, null);

    const openBillResponse = await fetch(
      `${baseUrl}/api/admin/service-points/${encodeURIComponent(court.id)}/open-bill`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: cookie },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(openBillResponse.status, 200);
    const emptyBill = adminBillDetailResponseSchema.parse(await openBillResponse.json());
    billId = emptyBill.bill.id;

    const emptyDashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(emptyDashboardResponse.status, 200);
    const emptyDashboard = adminDashboardResponseSchema.parse(await emptyDashboardResponse.json());
    const emptyDashboardCourt = emptyDashboard.servicePoints.find((entry) => entry.id === court.id);
    assert.equal(emptyDashboardCourt?.billLifecycleState, 'OPEN_EMPTY');
    assert.equal(emptyDashboardCourt?.openBill?.id, billId);

    const hiddenEmptyResponse = await fetch(
      `${baseUrl}/api/public/service-points/${court.slug}/bill`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(hiddenEmptyResponse.status, 200);
    const hiddenEmpty = publicCurrentBillResponseSchema.parse(await hiddenEmptyResponse.json());
    assert.equal(hiddenEmpty.bill, null);

    const contextResponse = await fetch(
      `${baseUrl}/api/public/service-points/${court.slug}/context`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(contextResponse.status, 200);
    const context = publicServicePointContextSchema.parse(await contextResponse.json());
    const item = context.categories.flatMap((category) => category.items)[0];
    assert.ok(item);

    const cancelledOrderResponse = await fetch(
      `${baseUrl}/api/public/service-points/${court.slug}/orders`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 1 }],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(cancelledOrderResponse.status, 201);
    const cancelledOrder = createOrderResponseSchema.parse(await cancelledOrderResponse.json());
    assert.equal(cancelledOrder.bill.id, billId);

    const cancelResponse = await fetch(
      `${baseUrl}/api/admin/orders/${encodeURIComponent(cancelledOrder.order.id)}/status`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          status: 'CANCELLED',
          reason: 'Verify cancelled activity retention',
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(cancelResponse.status, 200);
    adminBillDetailResponseSchema.parse(await cancelResponse.json());

    const cancelledDashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(cancelledDashboardResponse.status, 200);
    const cancelledDashboard = adminDashboardResponseSchema.parse(
      await cancelledDashboardResponse.json(),
    );
    assert.equal(
      cancelledDashboard.servicePoints.find((entry) => entry.id === court.id)?.billLifecycleState,
      'OPEN_ACTIVE',
    );

    const cancelledPublicResponse = await fetch(
      `${baseUrl}/api/public/service-points/${court.slug}/bill`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(cancelledPublicResponse.status, 200);
    const cancelledPublic = publicCurrentBillResponseSchema.parse(
      await cancelledPublicResponse.json(),
    );
    assert.equal(cancelledPublic.bill?.id, billId);
    assert.equal(cancelledPublic.orders.length, 1);
    assert.equal(cancelledPublic.orders[0]?.status, 'CANCELLED');
    assert.equal(cancelledPublic.summary.grossTotalVnd, 0);

    for (const quantity of [3, 2]) {
      const orderResponse: Response = await fetch(
        `${baseUrl}/api/public/service-points/${court.slug}/orders`,
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey: randomUUID(),
            items: [{ catalogItemId: item.id, quantity }],
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      assert.equal(orderResponse.status, 201);
      const created = createOrderResponseSchema.parse(await orderResponse.json());
      assert.equal(created.bill.id, billId);
    }

    const publicResponse = await fetch(`${baseUrl}/api/public/service-points/${court.slug}/bill`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(publicResponse.status, 200);
    const publicBill = publicCurrentBillResponseSchema.parse(await publicResponse.json());
    assert.equal(publicBill.bill?.id, billId);
    assert.equal(publicBill.orders.length, 3);
    assert.equal(publicBill.summary.items.length, 1);
    assert.equal(publicBill.summary.items[0]?.orderedQuantity, 5);
    assert.equal(publicBill.summary.grossTotalVnd, item.priceVnd * 5);
    assert.equal(publicBill.summary.outstandingTotalVnd, publicBill.summary.grossTotalVnd);

    const adminResponse = await fetch(`${baseUrl}/api/admin/bills/${encodeURIComponent(billId)}`, {
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(adminResponse.status, 200);
    const adminBill = adminBillDetailResponseSchema.parse(await adminResponse.json());
    assert.deepEqual(adminBill.summary, publicBill.summary);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(logoutResponse.status, 200);

    console.log(`Provisional bill projection HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          noBillReturnsNullBill: true,
          emptyOpenBillHiddenFromCustomer: true,
          cancelledOnlyBillRemainsActive: true,
          dashboardEmptyThenActive: true,
          orderHistoryCount: publicBill.orders.length,
          combinedQuantity: publicBill.summary.items[0]?.orderedQuantity,
          grossTotalVnd: publicBill.summary.grossTotalVnd,
          adminAndPublicSummaryMatch: true,
          publicEndpointRequiresNoAdminSession: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (billId) {
      await pool.query(
        `
          DELETE FROM activity_logs
          WHERE entity_id = $1
             OR entity_id IN (SELECT id FROM orders WHERE bill_id = $1)
             OR entity_id IN (SELECT id FROM order_lines WHERE bill_id = $1)
        `,
        [billId],
      );
      await pool.query(`DELETE FROM order_line_settlements WHERE bill_id = $1`, [billId]);
      await pool.query(`DELETE FROM court_rental_charges WHERE bill_id = $1`, [billId]);
      await pool.query(`DELETE FROM payment_batches WHERE bill_id = $1`, [billId]);
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
