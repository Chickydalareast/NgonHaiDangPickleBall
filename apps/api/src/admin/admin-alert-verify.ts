import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { AdminRealtimeEvent } from '@nhdp/contracts';
import { Client } from 'pg';

import { createAdminAlertService } from './admin-alert-service.js';
import { createAdminOrderOperationsService } from './admin-order-operations-service.js';
import { createAdminRealtimeHub } from './admin-realtime-hub.js';
import { createAdminServiceRequestService } from './admin-service-request-service.js';
import { readDatabaseEnvironment, readSeedEnvironment } from '../config/database-environment.js';
import { dropVerificationDatabase } from '../db/verification-database.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import { createPublicServiceRequestService } from '../service-request/public-service-request-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const seedEnvironment = readSeedEnvironment();
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const databaseName = `nhdp_stepx_alert_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${databaseName}`;
  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-stepx-alert-admin-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());
    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-stepx-alert-verifier',
      maxConnections: 12,
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
          `
          SELECT id
          FROM admin_users
          WHERE username = $1
          LIMIT 1
        `,
          [seedEnvironment.ADMIN_SEED_USERNAME],
        )
      ).rows[0];
      const servicePoint = (
        await database.pool.query<{ id: string; slug: string }>(
          `SELECT id, slug FROM service_points WHERE slug = 'san-01' LIMIT 1`,
        )
      ).rows[0];
      const catalogItem = (
        await database.pool.query<{ id: string }>(
          `SELECT id FROM catalog_items WHERE is_available = TRUE ORDER BY created_at, id LIMIT 1`,
        )
      ).rows[0];
      assert.ok(admin);
      assert.ok(servicePoint);
      assert.ok(catalogItem);

      const orderService = createOrderService(database.pool, hub);
      const publicServiceRequestService = createPublicServiceRequestService(database.pool, hub);
      const alertService = createAdminAlertService(database.pool, hub);
      const orderOperationsService = createAdminOrderOperationsService(database.pool, hub);
      const adminServiceRequestService = createAdminServiceRequestService(database.pool, hub);

      const order = await orderService.create({
        servicePointSlug: servicePoint.slug,
        request: {
          idempotencyKey: randomUUID(),
          note: 'Step X realtime alert verification',
          items: [{ catalogItemId: catalogItem.id, quantity: 2 }],
        },
      });
      const serviceRequest = await publicServiceRequestService.create({
        servicePointSlug: servicePoint.slug,
        request: { message: 'Cần nhân viên hỗ trợ kiểm thử cảnh báo' },
      });

      const beforeAcknowledgement = await alertService.read();
      assert.equal(beforeAcknowledgement.alerts.length, 2);
      assert.equal(beforeAcknowledgement.alerts[0]?.kind, 'SERVICE_REQUEST');
      assert.equal(beforeAcknowledgement.alerts[1]?.kind, 'ORDER');
      assert.equal(
        beforeAcknowledgement.alerts.every((alert) => alert.acknowledgedAt === null),
        true,
      );

      const orderAcknowledgements = await Promise.all(
        Array.from({ length: 8 }, () =>
          alertService.acknowledgeOrder({
            adminUserId: admin.id,
            orderId: order.order.id,
          }),
        ),
      );
      const requestAcknowledgements = await Promise.all(
        Array.from({ length: 8 }, () =>
          alertService.acknowledgeServiceRequest({
            adminUserId: admin.id,
            serviceRequestId: serviceRequest.request.id,
          }),
        ),
      );

      assert.equal(orderAcknowledgements.filter((result) => !result.replayed).length, 1);
      assert.equal(orderAcknowledgements.filter((result) => result.replayed).length, 7);
      assert.equal(requestAcknowledgements.filter((result) => !result.replayed).length, 1);
      assert.equal(requestAcknowledgements.filter((result) => result.replayed).length, 7);

      const afterAcknowledgement = await alertService.read();
      assert.equal(afterAcknowledgement.alerts.length, 2);
      assert.equal(
        afterAcknowledgement.alerts.every((alert) => alert.acknowledgedAt !== null),
        true,
      );
      assert.equal(afterAcknowledgement.alerts[0]?.kind, 'SERVICE_REQUEST');
      assert.equal(afterAcknowledgement.alerts[1]?.kind, 'ORDER');

      const activityCounts = (
        await database.pool.query<{ order_count: number; service_request_count: number }>(
          `
            SELECT
              COUNT(*) FILTER (
                WHERE action = 'order.alert_acknowledged' AND entity_id = $1
              )::integer AS order_count,
              COUNT(*) FILTER (
                WHERE action = 'service_request.alert_acknowledged' AND entity_id = $2
              )::integer AS service_request_count
            FROM activity_logs
          `,
          [order.order.id, serviceRequest.request.id],
        )
      ).rows[0];
      assert.equal(activityCounts?.order_count, 1);
      assert.equal(activityCounts?.service_request_count, 1);

      await orderOperationsService.updateOrderStatus({
        adminUserId: admin.id,
        orderId: order.order.id,
        request: { status: 'ACCEPTED' },
      });
      await adminServiceRequestService.resolve({
        adminUserId: admin.id,
        serviceRequestId: serviceRequest.request.id,
      });

      assert.deepEqual((await alertService.read()).alerts, []);
      assert.equal(events.filter((event) => event.type === 'order.alert-acknowledged').length, 1);
      assert.equal(
        events.filter((event) => event.type === 'service-request.alert-acknowledged').length,
        1,
      );

      console.log('Admin realtime alert database verification PASS.');
      console.log(
        JSON.stringify(
          {
            activeAlertsBeforeAcknowledgement: beforeAcknowledgement.alerts.length,
            concurrentOrderAcknowledgements: orderAcknowledgements.length,
            concurrentServiceRequestAcknowledgements: requestAcknowledgements.length,
            persistentAcknowledgementRows: activityCounts,
            activeAlertsAfterResolution: 0,
            eventTypes: events.map((event) => event.type),
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
