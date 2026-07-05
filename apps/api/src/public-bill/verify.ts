import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { createAdminOrderOperationsService } from '../admin/admin-order-operations-service.js';
import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import {
  PublicCurrentBillDomainError,
  createPublicCurrentBillService,
} from './public-current-bill-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_step10pro_b_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);

  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step10pro-b-admin-verifier',
  });
  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());

    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step10pro-b-verifier',
      maxConnections: 8,
    });

    try {
      const createOrder = createOrderService(database.pool);
      const publicBill = createPublicCurrentBillService(database.pool);
      const adminOperations = createAdminOrderOperationsService(database.pool);

      const servicePointsResult = await database.pool.query<{ slug: string }>(
        `SELECT slug FROM service_points WHERE slug IN ('san-01', 'san-02') ORDER BY slug`,
      );
      assert.deepEqual(
        servicePointsResult.rows.map((row) => row.slug),
        ['san-01', 'san-02'],
      );

      const itemResult = await database.pool.query<{ id: string; price_vnd: number }>(
        `
          SELECT id, price_vnd
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE
          ORDER BY sort_order, id
          LIMIT 1
        `,
      );
      const item = itemResult.rows[0];
      assert.ok(item);

      const first = await createOrder.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 3 }],
        },
      });
      const second = await createOrder.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 2 }],
        },
      });
      assert.equal(first.bill.id, second.bill.id);

      const grouped = await publicBill.read('san-01');
      assert.equal(grouped.bill?.id, first.bill.id);
      assert.equal(grouped.orders.length, 2);
      assert.equal(grouped.summary.items.length, 1);
      assert.equal(grouped.summary.items[0]?.orderedQuantity, 5);
      assert.equal(grouped.summary.grossTotalVnd, item.price_vnd * 5);
      assert.equal(grouped.summary.outstandingTotalVnd, grouped.summary.grossTotalVnd);
      assert.equal(grouped.summary.paidTotalVnd, 0);
      assert.equal(grouped.summary.waivedTotalVnd, 0);

      const adminDetail = await adminOperations.readBill(first.bill.id);
      assert.ok(adminDetail);
      assert.deepEqual(adminDetail.summary, grouped.summary);
      assert.equal(adminDetail.bill.totalVnd, grouped.summary.grossTotalVnd);

      const newPrice = item.price_vnd + 2_000;
      await database.pool.query(`UPDATE catalog_items SET price_vnd = $2 WHERE id = $1`, [
        item.id,
        newPrice,
      ]);
      await createOrder.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 1 }],
        },
      });

      const cancelled = await createOrder.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 4 }],
        },
      });
      const adminResult = await database.pool.query<{ id: string }>(
        `SELECT id FROM admin_users WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`,
      );
      const adminUserId = adminResult.rows[0]?.id;
      assert.ok(adminUserId);
      await adminOperations.updateOrderStatus({
        adminUserId,
        orderId: cancelled.order.id,
        request: { status: 'CANCELLED', reason: 'Verify projection exclusion' },
      });

      const separated = await publicBill.read('san-01');
      assert.equal(separated.summary.items.length, 2);
      assert.deepEqual(
        separated.summary.items.map((entry) => entry.unitPriceVnd),
        [item.price_vnd, newPrice],
      );
      assert.deepEqual(
        separated.summary.items.map((entry) => entry.orderedQuantity),
        [5, 1],
      );
      assert.equal(separated.summary.grossTotalVnd, item.price_vnd * 5 + newPrice);
      assert.equal(
        separated.orders.find((order) => order.id === cancelled.order.id)?.status,
        'CANCELLED',
      );

      const empty = await publicBill.read('san-02');
      assert.equal(empty.bill, null);
      assert.deepEqual(empty.orders, []);
      assert.equal(empty.summary.grossTotalVnd, 0);
      assert.deepEqual(empty.summary.items, []);

      await database.pool.query(
        `UPDATE service_points SET status = 'INACTIVE', updated_at = now() WHERE slug = 'san-02'`,
      );
      await assert.rejects(
        publicBill.read('san-02'),
        (error: unknown) =>
          error instanceof PublicCurrentBillDomainError && error.code === 'SERVICE_POINT_NOT_FOUND',
      );

      console.log('Provisional bill projection database verification PASS.');
      console.log(
        JSON.stringify(
          {
            combinedQuantity: grouped.summary.items[0]?.orderedQuantity,
            priceSnapshotsSeparated: true,
            cancelledOrderExcludedFromSummary: true,
            adminAndPublicSummaryMatch: true,
            emptyCourtReturnsNullBill: true,
            inactiveCourtRejected: true,
            grossTotalVnd: separated.summary.grossTotalVnd,
          },
          null,
          2,
        ),
      );
    } finally {
      await database.pool.end();
    }
  } finally {
    await adminClient.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(verificationDatabase)} WITH (FORCE)`,
    );
    await adminClient.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
