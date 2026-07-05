import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createOrderRequestSchema, type AdminRealtimeEvent } from '@nhdp/contracts';
import { Client } from 'pg';

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import { createAdminSettlementService } from '../settlement/admin-settlement-service.js';
import {
  AdminBillCompletionDomainError,
  createAdminBillCompletionService,
} from './admin-bill-completion-service.js';
import { createAdminDashboardRepository } from './admin-dashboard-repository.js';
import {
  AdminOrderOperationDomainError,
  createAdminOrderOperationsService,
} from './admin-order-operations-service.js';
import { createAdminRealtimeHub } from './admin-realtime-hub.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const databaseName = `nhdp_step8_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${databaseName}`;
  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step8-admin-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());
    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step8-verifier',
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
      const admin = (
        await database.pool.query<{ id: string }>(
          `SELECT id FROM admin_users WHERE username = 'admin' LIMIT 1`,
        )
      ).rows[0];
      const servicePoint = (
        await database.pool.query<{ id: string; slug: string }>(
          `SELECT id, slug FROM service_points WHERE slug = 'san-01' LIMIT 1`,
        )
      ).rows[0];
      const item = (
        await database.pool.query<{ id: string; price_vnd: number }>(
          `
            SELECT id, price_vnd
            FROM catalog_items
            WHERE status = 'ACTIVE' AND is_available = TRUE
            ORDER BY sort_order, id
            LIMIT 1
          `,
        )
      ).rows[0];
      assert.ok(admin);
      assert.ok(servicePoint);
      assert.ok(item);

      const createService = createOrderService(database.pool, hub);
      const operations = createAdminOrderOperationsService(database.pool, hub);
      const settlements = createAdminSettlementService(
        database.pool,
        (billId) => operations.readBill(billId),
        hub,
      );
      const completion = createAdminBillCompletionService(database.pool, hub);
      const dashboard = createAdminDashboardRepository(database.pool);

      const firstOrder = await createService.create({
        servicePointSlug: servicePoint.slug,
        request: createOrderRequestSchema.parse({
          idempotencyKey: randomUUID(),
          note: 'Step 8 bill completion verification',
          items: [{ catalogItemId: item.id, quantity: 2 }],
        }),
      });

      await assert.rejects(
        completion.completeBill({
          adminUserId: admin.id,
          billId: firstOrder.bill.id,
        }),
        (error: unknown) =>
          error instanceof AdminBillCompletionDomainError &&
          error.code === 'BILL_HAS_OUTSTANDING_SETTLEMENTS',
      );

      const detailBeforeSettlement = await operations.readBill(firstOrder.bill.id);
      assert.ok(detailBeforeSettlement);
      const line = detailBeforeSettlement.orders
        .flatMap((order) => order.lines)
        .find((entry) => entry.catalogItemId === item.id);
      assert.ok(line);

      await settlements.create({
        adminUserId: admin.id,
        lineId: line.id,
        request: {
          idempotencyKey: randomUUID(),
          type: 'PAID',
          quantity: 2,
        },
      });

      const completed = await completion.completeBill({
        adminUserId: admin.id,
        billId: firstOrder.bill.id,
      });
      assert.equal(completed.status, 'COMPLETED');
      assert.equal(completed.totalVnd, item.price_vnd * 2);

      const storedBill = (
        await database.pool.query<{
          status: string;
          total_vnd: number;
          completed_at: Date | null;
        }>(`SELECT status, total_vnd, completed_at FROM bills WHERE id = $1`, [firstOrder.bill.id])
      ).rows[0];
      assert.equal(storedBill?.status, 'COMPLETED');
      assert.equal(storedBill?.total_vnd, item.price_vnd * 2);
      assert.ok(storedBill?.completed_at);

      const afterCompletion = await dashboard.read();
      const completedCourt = afterCompletion.servicePoints.find(
        (entry) => entry.id === servicePoint.id,
      );
      assert.equal(completedCourt?.openBill, null);

      await assert.rejects(
        operations.addBillItem({
          adminUserId: admin.id,
          billId: firstOrder.bill.id,
          request: { catalogItemId: item.id, quantity: 1 },
        }),
        (error: unknown) =>
          error instanceof AdminOrderOperationDomainError && error.code === 'ADMIN_BILL_NOT_OPEN',
      );

      const secondOrder = await createService.create({
        servicePointSlug: servicePoint.slug,
        request: createOrderRequestSchema.parse({
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 1 }],
        }),
      });
      assert.notEqual(secondOrder.bill.id, firstOrder.bill.id);
      assert.equal(secondOrder.bill.status, 'OPEN');

      const afterNewOrder = await dashboard.read();
      const reopenedCourt = afterNewOrder.servicePoints.find(
        (entry) => entry.id === servicePoint.id,
      );
      assert.equal(reopenedCourt?.openBill?.id, secondOrder.bill.id);

      const activity = (
        await database.pool.query<{ count: string }>(
          `
            SELECT COUNT(*)::text AS count
            FROM activity_logs
            WHERE action = 'bill.completed' AND entity_id = $1
          `,
          [firstOrder.bill.id],
        )
      ).rows[0];
      assert.equal(Number(activity?.count ?? 0), 1);
      assert.ok(
        events.some(
          (event) => event.type === 'bill.completed' && event.billId === firstOrder.bill.id,
        ),
      );

      console.log('Admin bill completion database verification PASS.');
      console.log(
        JSON.stringify(
          {
            completedBillId: firstOrder.bill.id,
            completedTotalVnd: completed.totalVnd,
            courtFreeAfterCompletion: completedCourt?.openBill === null,
            newBillId: secondOrder.bill.id,
            newBillCreated: secondOrder.bill.id !== firstOrder.bill.id,
            outstandingCompletionBlocked: true,
            pendingOrderSettled: true,
            pendingOrderCompleted: true,
            fullySettledBeforeCompletion: true,
            eventPublished: true,
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
    await adminClient.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    );
    await adminClient.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
