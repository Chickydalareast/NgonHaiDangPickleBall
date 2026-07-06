import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createOrderRequestSchema, type AdminRealtimeEvent } from '@nhdp/contracts';
import { Client } from 'pg';

import { readDatabaseEnvironment, readSeedEnvironment } from '../config/database-environment.js';
import { dropVerificationDatabase } from '../db/verification-database.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import {
  createAdminOrderOperationsService,
  AdminOrderOperationDomainError,
} from './admin-order-operations-service.js';
import { createAdminRealtimeHub } from './admin-realtime-hub.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const seedEnvironment = readSeedEnvironment();
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const databaseName = `nhdp_step7_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${databaseName}`;
  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step7-admin-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());
    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step7-verifier',
      maxConnections: 6,
    });
    const hub = createAdminRealtimeHub();
    const events: AdminRealtimeEvent[] = [];
    const unsubscribe = hub.subscribe({
      send(event) {
        events.push(event);
      },
      close() {
        return;
      },
    });

    try {
      const adminResult = await database.pool.query<{ id: string }>(
        `
          SELECT id
          FROM admin_users
          WHERE username = $1
          LIMIT 1
        `,
        [seedEnvironment.ADMIN_SEED_USERNAME],
      );
      const servicePointResult = await database.pool.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM service_points WHERE slug = 'san-01' LIMIT 1`,
      );
      const itemResult = await database.pool.query<{ id: string; price_vnd: number }>(
        `
          SELECT id, price_vnd
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE
          ORDER BY sort_order, id
          LIMIT 2
        `,
      );
      const admin = adminResult.rows[0];
      const servicePoint = servicePointResult.rows[0];
      const firstItem = itemResult.rows[0];
      const secondItem = itemResult.rows[1] ?? firstItem;
      assert.ok(admin);
      assert.ok(servicePoint);
      assert.ok(firstItem);
      assert.ok(secondItem);

      const createService = createOrderService(database.pool, hub);
      const operations = createAdminOrderOperationsService(database.pool, hub);
      const firstOrder = await createService.create({
        servicePointSlug: servicePoint.slug,
        request: createOrderRequestSchema.parse({
          idempotencyKey: randomUUID(),
          note: 'Step 7 first order',
          items: [{ catalogItemId: firstItem.id, quantity: 2 }],
        }),
      });
      let detail = await operations.readBill(firstOrder.bill.id);
      assert.ok(detail);
      const firstLine = detail.orders[0]?.lines[0];
      assert.ok(firstLine);

      detail = await operations.updateOrderLine({
        adminUserId: admin.id,
        lineId: firstLine.id,
        request: { quantity: 3 },
      });
      assert.equal(detail.orders[0]?.lines[0]?.quantity, 3);
      assert.equal(detail.bill.totalVnd, firstItem.price_vnd * 3);

      detail = await operations.updateOrderStatus({
        adminUserId: admin.id,
        orderId: firstOrder.order.id,
        request: { status: 'ACCEPTED' },
      });
      assert.equal(detail.orders[0]?.status, 'ACCEPTED');

      detail = await operations.updateOrderStatus({
        adminUserId: admin.id,
        orderId: firstOrder.order.id,
        request: { status: 'SERVED' },
      });
      assert.equal(detail.orders[0]?.status, 'SERVED');

      detail = await operations.voidOrderLine({
        adminUserId: admin.id,
        lineId: firstLine.id,
        request: { reason: 'Khách không dùng món' },
      });
      assert.equal(detail.orders[0]?.lines[0]?.status, 'VOIDED');
      assert.equal(detail.bill.totalVnd, 0);

      detail = await operations.addBillItem({
        adminUserId: admin.id,
        billId: firstOrder.bill.id,
        request: { catalogItemId: secondItem.id, quantity: 2 },
      });
      const adminOrder = detail.orders.find((order) => order.source === 'ADMIN');
      assert.ok(adminOrder);
      assert.equal(adminOrder.status, 'ACCEPTED');
      assert.equal(detail.bill.totalVnd, secondItem.price_vnd * 2);

      const secondOrder = await createService.create({
        servicePointSlug: servicePoint.slug,
        request: createOrderRequestSchema.parse({
          idempotencyKey: randomUUID(),
          note: 'Step 7 cancelled order',
          items: [{ catalogItemId: firstItem.id, quantity: 1 }],
        }),
      });
      detail = await operations.updateOrderStatus({
        adminUserId: admin.id,
        orderId: secondOrder.order.id,
        request: { status: 'CANCELLED', reason: 'Khách đổi ý' },
      });
      const cancelled = detail.orders.find((order) => order.id === secondOrder.order.id);
      assert.equal(cancelled?.status, 'CANCELLED');
      assert.equal(cancelled?.totalVnd, 0);
      assert.ok(cancelled?.lines.every((line) => line.status === 'VOIDED'));
      assert.equal(detail.bill.totalVnd, secondItem.price_vnd * 2);

      const thirdOrder = await createService.create({
        servicePointSlug: servicePoint.slug,
        request: createOrderRequestSchema.parse({
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: firstItem.id, quantity: 1 }],
        }),
      });
      await assert.rejects(
        operations.updateOrderStatus({
          adminUserId: admin.id,
          orderId: thirdOrder.order.id,
          request: { status: 'SERVED' },
        }),
        (error: unknown) =>
          error instanceof AdminOrderOperationDomainError &&
          error.code === 'INVALID_ORDER_TRANSITION',
      );

      const activityResult = await database.pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM activity_logs
          WHERE actor_type = 'ADMIN'
        `,
      );
      assert.ok(Number(activityResult.rows[0]?.count ?? 0) >= 6);
      assert.ok(events.some((event) => event.type === 'order.accepted'));
      assert.ok(events.some((event) => event.type === 'order.served'));
      assert.ok(events.some((event) => event.type === 'order.cancelled'));
      assert.ok(events.some((event) => event.type === 'bill.updated'));

      console.log('Admin order operations database verification PASS.');
      console.log(
        JSON.stringify(
          {
            billId: firstOrder.bill.id,
            finalBillTotalVnd: detail.bill.totalVnd,
            manualOrderCreated: true,
            cancellationVoidedLines: true,
            eventTypes: [...new Set(events.map((event) => event.type))],
          },
          null,
          2,
        ),
      );
    } finally {
      unsubscribe();
      hub.close();
      await database.pool.end();
    }
  } finally {
    await dropVerificationDatabase(adminClient, databaseName);
    await adminClient.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
