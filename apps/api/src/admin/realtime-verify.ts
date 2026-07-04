import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createOrderRequestSchema, type AdminRealtimeEvent } from '@nhdp/contracts';
import { Client } from 'pg';

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import { createAdminRealtimeHub } from './admin-realtime-hub.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function verifyAdminRealtime(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_step6_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);

  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step6-admin-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());

    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step6-verifier',
      maxConnections: 5,
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
      const service = createOrderService(database.pool, hub);
      const servicePointResult = await database.pool.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM service_points WHERE slug = 'san-01' LIMIT 1`,
      );
      const itemResult = await database.pool.query<{ id: string }>(
        `
          SELECT id
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE
          ORDER BY sort_order, id
          LIMIT 1
        `,
      );
      const servicePoint = servicePointResult.rows[0];
      const item = itemResult.rows[0];

      assert.ok(servicePoint);
      assert.ok(item);

      const request = createOrderRequestSchema.parse({
        idempotencyKey: randomUUID(),
        note: 'Step 6 realtime verification',
        items: [{ catalogItemId: item.id, quantity: 1 }],
      });
      const first = await service.create({
        servicePointSlug: servicePoint.slug,
        request,
      });
      const replay = await service.create({
        servicePointSlug: servicePoint.slug,
        request,
      });

      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.order.id, first.order.id);
      assert.equal(events.length, 1, 'Idempotent replay must not publish a duplicate event.');
      assert.deepEqual(events[0], {
        type: 'order.created',
        servicePointId: servicePoint.id,
        billId: first.bill.id,
        orderId: first.order.id,
      });

      console.log('Admin realtime database verification PASS.');
      console.log(
        JSON.stringify(
          {
            emittedEvents: events.length,
            eventType: events[0]?.type,
            orderId: first.order.id,
            replayPublishedDuplicate: false,
            subscribers: hub.subscriberCount(),
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
      `DROP DATABASE IF EXISTS ${quoteIdentifier(verificationDatabase)} WITH (FORCE)`,
    );
    await adminClient.end();
  }
}

void verifyAdminRealtime().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
