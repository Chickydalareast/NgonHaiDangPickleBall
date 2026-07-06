import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createOrderRequestSchema } from '@nhdp/contracts';
import { Client } from 'pg';

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { CreateOrderDomainError, createOrderService } from './create-order-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function waitForDatabaseConnectionsToClose(
  adminClient: Client,
  databaseName: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const result = await adminClient.query<{ connections: number }>(
      `
        SELECT COUNT(*)::integer AS connections
        FROM pg_stat_activity
        WHERE datname = $1
      `,
      [databaseName],
    );

    if ((result.rows[0]?.connections ?? 0) === 0) {
      return;
    }

    await delay(50);
  }

  throw new Error(`Timed out waiting for database connections to close: ${databaseName}`);
}

async function verifyCreateOrderTransaction(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_step4_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);

  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step4-admin-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());

    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step4-verifier',
      maxConnections: 20,
    });

    try {
      const service = createOrderService(database.pool);
      const servicePointResult = await database.pool.query<{
        id: string;
        slug: string;
      }>(`SELECT id, slug FROM service_points WHERE slug = 'san-01' LIMIT 1`);
      const itemResult = await database.pool.query<{
        id: string;
        price_vnd: number;
      }>(
        `
          SELECT id, price_vnd
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE
          ORDER BY sort_order, id
          LIMIT 2
        `,
      );
      const servicePoint = servicePointResult.rows[0];
      const firstItem = itemResult.rows[0];
      const secondItem = itemResult.rows[1];

      assert.ok(servicePoint);
      assert.ok(firstItem);
      assert.ok(secondItem);

      const spoofedRequest = createOrderRequestSchema.safeParse({
        idempotencyKey: randomUUID(),
        items: [
          {
            catalogItemId: firstItem.id,
            quantity: 1,
            unitPriceVnd: 1,
          },
        ],
      });

      assert.equal(
        spoofedRequest.success,
        false,
        'Client supplied prices must not be accepted by the contract.',
      );

      const duplicateKey = randomUUID();
      const duplicateRequest = createOrderRequestSchema.parse({
        idempotencyKey: duplicateKey,
        note: 'Step 4 duplicate verification',
        items: [{ catalogItemId: firstItem.id, quantity: 2 }],
      });
      const duplicateResults = await Promise.all(
        Array.from({ length: 8 }, () =>
          service.create({
            servicePointSlug: servicePoint.slug,
            request: duplicateRequest,
          }),
        ),
      );
      const duplicateOrderIds = new Set(duplicateResults.map((result) => result.order.id));

      assert.equal(duplicateOrderIds.size, 1);
      assert.equal(duplicateResults.filter((result) => !result.replayed).length, 1);
      assert.equal(duplicateResults[0]?.order.totalVnd, firstItem.price_vnd * 2);

      const concurrentRequests = Array.from({ length: 20 }, (_, index) => ({
        servicePointSlug: servicePoint.slug,
        request: createOrderRequestSchema.parse({
          idempotencyKey: randomUUID(),
          note: `Concurrent order ${index + 1}`,
          items: [{ catalogItemId: firstItem.id, quantity: 1 }],
        }),
      }));

      await Promise.all(concurrentRequests.map((command) => service.create(command)));

      const summary = await database.pool.query<{
        bill_total_vnd: number;
        open_bills: number;
        orders: number;
      }>(
        `
          SELECT
            (SELECT COUNT(*)::integer FROM bills WHERE status = 'OPEN') AS open_bills,
            (SELECT COUNT(*)::integer FROM orders) AS orders,
            (SELECT total_vnd FROM bills WHERE status = 'OPEN' LIMIT 1) AS bill_total_vnd
        `,
      );
      const counts = summary.rows[0];

      assert.ok(counts);
      assert.equal(counts.open_bills, 1);
      assert.equal(counts.orders, 21);
      assert.equal(counts.bill_total_vnd, firstItem.price_vnd * 22);

      await database.pool.query(`UPDATE catalog_items SET is_available = FALSE WHERE id = $1`, [
        secondItem.id,
      ]);

      await assert.rejects(
        service.create({
          servicePointSlug: servicePoint.slug,
          request: createOrderRequestSchema.parse({
            idempotencyKey: randomUUID(),
            items: [{ catalogItemId: secondItem.id, quantity: 1 }],
          }),
        }),
        (error: unknown) =>
          error instanceof CreateOrderDomainError && error.code === 'CATALOG_ITEM_UNAVAILABLE',
      );

      console.log('Create order transaction verification PASS.');
      console.log(
        JSON.stringify(
          {
            concurrentOrders: 20,
            duplicateAttempts: 8,
            openBills: counts.open_bills,
            orders: counts.orders,
            totalVnd: counts.bill_total_vnd,
          },
          null,
          2,
        ),
      );
    } finally {
      await database.pool.end();
    }
  } finally {
    await waitForDatabaseConnectionsToClose(adminClient, verificationDatabase);
    await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(verificationDatabase)}`);
    await adminClient.end();
  }
}

void verifyCreateOrderTransaction().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
