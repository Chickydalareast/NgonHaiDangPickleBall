import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createOrderRequestSchema } from '@nhdp/contracts';
import { Client } from 'pg';

import { createAdminBillCompletionService } from '../admin/admin-bill-completion-service.js';
import { createAdminOrderOperationsService } from '../admin/admin-order-operations-service.js';
import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { createOrderService } from '../order/create-order-service.js';
import { seedDatabase } from '../db/seed-service.js';
import { createAdminCheckoutService } from './admin-checkout-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_checkout_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-checkout-admin-verifier',
  });
  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());

    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-checkout-verifier',
      maxConnections: 8,
    });

    try {
      const operations = createAdminOrderOperationsService(database.pool);
      const checkout = createAdminCheckoutService(database.pool, (billId) =>
        operations.readBill(billId),
      );
      const completion = createAdminBillCompletionService(database.pool);
      const adminResult = await database.pool.query<{ id: string }>(
        `SELECT id FROM admin_users WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`,
      );
      const adminUserId = adminResult.rows[0]?.id;
      assert.ok(adminUserId);
      const servicePointResult = await database.pool.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM service_points WHERE code = 'COURT-03' LIMIT 1`,
      );
      const servicePoint = servicePointResult.rows[0];
      assert.ok(servicePoint);
      const itemResult = await database.pool.query<{ id: string; price_vnd: number }>(
        `SELECT id, price_vnd FROM catalog_items WHERE status = 'ACTIVE' AND is_available = TRUE ORDER BY sort_order, id LIMIT 1`,
      );
      const item = itemResult.rows[0];
      assert.ok(item);

      const opened = await checkout.openBill({ adminUserId, servicePointId: servicePoint.id });
      assert.equal(opened.bill.totalVnd, 0);

      const customerOrder = await createOrderService(database.pool).create({
        servicePointSlug: servicePoint.slug,
        request: createOrderRequestSchema.parse({
          idempotencyKey: randomUUID(),
          note: 'Pending order must remain payable at checkout',
          items: [{ catalogItemId: item.id, quantity: 1 }],
        }),
      });
      assert.equal(customerOrder.bill.id, opened.bill.id);
      assert.equal(customerOrder.order.status, 'PENDING');

      const rental = await checkout.createCourtRental({
        adminUserId,
        billId: opened.bill.id,
        request: {
          idempotencyKey: randomUUID(),
          startTime: '16:30',
          durationHours: 2,
        },
      });
      assert.equal(rental.courtRental.baseAmountVnd, 240_000);
      assert.equal(rental.courtRental.surchargeAmountVnd, 60_000);
      assert.equal(rental.courtRental.totalAmountVnd, 300_000);
      assert.equal(rental.bill.summary.outstandingTotalVnd, 300_000 + item.price_vnd);

      const beforePayment = await checkout.readPreview(opened.bill.id);
      assert.equal(beforePayment.outstandingTotalVnd, 300_000 + item.price_vnd);
      assert.equal(beforePayment.courtRentals.length, 1);
      const rentalLine = rental.bill.orders
        .flatMap((order) => order.lines)
        .find((line) => line.id === rental.courtRental.orderLineId);
      assert.ok(rentalLine);
      const pendingLine = rental.bill.orders
        .find((order) => order.id === customerOrder.order.id)
        ?.lines.find((line) => line.catalogItemId === item.id);
      assert.ok(pendingLine);

      await checkout.createPaymentBatch({
        adminUserId,
        billId: opened.bill.id,
        request: {
          idempotencyKey: randomUUID(),
          allocations: [
            { lineId: pendingLine.id, quantity: 1 },
            { lineId: rentalLine.id, quantity: 1 },
          ],
        },
      });

      const afterPayment = await checkout.readPreview(opened.bill.id);
      assert.equal(afterPayment.outstandingTotalVnd, 0);
      assert.equal(afterPayment.paidTotalVnd, 300_000 + item.price_vnd);
      assert.equal(afterPayment.paymentBatches.length, 1);

      const completed = await completion.completeBill({
        adminUserId,
        billId: opened.bill.id,
        request: { revision: afterPayment.revision },
      });
      assert.equal(completed.status, 'COMPLETED');

      const nextBill = await checkout.openBill({
        adminUserId,
        servicePointId: servicePoint.id,
      });
      assert.notEqual(nextBill.bill.id, opened.bill.id);
      assert.equal(nextBill.bill.totalVnd, 0);

      console.log('Checkout and court-rental verification PASS.');
      console.log(
        JSON.stringify(
          {
            court: 'COURT-03',
            rentalTotalVnd: rental.courtRental.totalAmountVnd,
            paymentBatches: afterPayment.paymentBatches.length,
            pendingCustomerOrderPaid: true,
            pendingCustomerOrderCompleted: true,
            completedBillId: completed.billId,
            nextBillId: nextBill.bill.id,
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
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
      [verificationDatabase],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(verificationDatabase)}`);
    await adminClient.end();
  }
}

await main();
