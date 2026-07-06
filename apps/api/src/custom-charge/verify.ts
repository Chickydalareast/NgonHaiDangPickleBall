import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { createAdminOrderOperationsService } from '../admin/admin-order-operations-service.js';
import { readDatabaseEnvironment } from '../config/database-environment.js';
import { dropVerificationDatabase } from '../db/verification-database.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import { createPublicCurrentBillService } from '../public-bill/public-current-bill-service.js';
import {
  AdminCustomChargeDomainError,
  createAdminCustomChargeService,
} from './admin-custom-charge-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_step10pro_c_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);

  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step10pro-c-admin-verifier',
  });
  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());

    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step10pro-c-verifier',
      maxConnections: 8,
    });

    try {
      const orderService = createOrderService(database.pool);
      const adminOperations = createAdminOrderOperationsService(database.pool);
      const customCharges = createAdminCustomChargeService(database.pool, (billId) =>
        adminOperations.readBill(billId),
      );
      const publicBill = createPublicCurrentBillService(database.pool);

      const itemResult = await database.pool.query<{ id: string }>(
        `
          SELECT id
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE
          ORDER BY sort_order, id
          LIMIT 1
        `,
      );
      const item = itemResult.rows[0];
      assert.ok(item);

      const created = await orderService.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 1 }],
        },
      });

      const adminResult = await database.pool.query<{ id: string }>(
        `SELECT id FROM admin_users WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`,
      );
      const adminUserId = adminResult.rows[0]?.id;
      assert.ok(adminUserId);

      const productKey = randomUUID();
      const afterProduct = await customCharges.create({
        adminUserId,
        billId: created.bill.id,
        request: {
          kind: 'MANUAL_PRODUCT',
          idempotencyKey: productKey,
          name: 'Phí khăn thuê',
          unitName: 'Cái',
          quantity: 2,
          unitPriceVnd: 15_000,
        },
      });
      const productLine = afterProduct.orders
        .flatMap((order) => order.lines)
        .find((line) => line.lineKind === 'MANUAL_PRODUCT');
      assert.ok(productLine);
      assert.equal(productLine.catalogItemId, null);
      assert.equal(productLine.lineTotalVnd, 30_000);

      const replay = await customCharges.create({
        adminUserId,
        billId: created.bill.id,
        request: {
          kind: 'MANUAL_PRODUCT',
          idempotencyKey: productKey,
          name: 'Phí khăn thuê',
          unitName: 'Cái',
          quantity: 2,
          unitPriceVnd: 15_000,
        },
      });
      assert.equal(
        replay.orders
          .flatMap((order) => order.lines)
          .filter((line) => line.lineKind === 'MANUAL_PRODUCT').length,
        1,
      );

      await assert.rejects(
        customCharges.create({
          adminUserId,
          billId: created.bill.id,
          request: {
            kind: 'MANUAL_PRODUCT',
            idempotencyKey: productKey,
            name: 'Khoản khác',
            unitName: 'Khoản',
            quantity: 1,
            unitPriceVnd: 1,
          },
        }),
        (error: unknown) =>
          error instanceof AdminCustomChargeDomainError &&
          error.code === 'CUSTOM_CHARGE_IDEMPOTENCY_CONFLICT',
      );

      const afterTime = await customCharges.create({
        adminUserId,
        billId: created.bill.id,
        request: {
          kind: 'MANUAL_TIME',
          idempotencyKey: randomUUID(),
          name: 'Thuê vợt',
          durationMinutes: 75,
          billingIntervalMinutes: 30,
          pricePerIntervalVnd: 20_000,
        },
      });
      const timeLine = afterTime.orders
        .flatMap((order) => order.lines)
        .find((line) => line.lineKind === 'MANUAL_TIME');
      assert.ok(timeLine);
      assert.equal(timeLine.catalogItemId, null);
      assert.equal(timeLine.quantity, 3);
      assert.equal(timeLine.durationMinutes, 75);
      assert.equal(timeLine.billingIntervalMinutes, 30);
      assert.equal(timeLine.lineTotalVnd, 60_000);

      const updated = await customCharges.update({
        adminUserId,
        chargeId: productLine.id,
        request: {
          kind: 'MANUAL_PRODUCT',
          name: 'Phí khăn thuê',
          unitName: 'Cái',
          quantity: 3,
          unitPriceVnd: 10_000,
        },
      });
      const updatedProduct = updated.orders
        .flatMap((order) => order.lines)
        .find((line) => line.id === productLine.id);
      assert.equal(updatedProduct?.quantity, 3);
      assert.equal(updatedProduct?.lineTotalVnd, 30_000);

      await assert.rejects(
        customCharges.update({
          adminUserId,
          chargeId: productLine.id,
          request: {
            kind: 'MANUAL_TIME',
            name: 'Phí khăn thuê',
            durationMinutes: 30,
            billingIntervalMinutes: 30,
            pricePerIntervalVnd: 10_000,
          },
        }),
        (error: unknown) =>
          error instanceof AdminCustomChargeDomainError &&
          error.code === 'CUSTOM_CHARGE_KIND_IMMUTABLE',
      );

      const afterVoid = await customCharges.void({
        adminUserId,
        chargeId: timeLine.id,
        request: { reason: 'Khách không sử dụng dịch vụ thuê' },
      });
      const voidedTime = afterVoid.orders
        .flatMap((order) => order.lines)
        .find((line) => line.id === timeLine.id);
      assert.equal(voidedTime?.status, 'VOIDED');
      assert.equal(
        afterVoid.summary.items.some((entry) => entry.lineKind === 'MANUAL_TIME'),
        false,
      );

      const publicSnapshot = await publicBill.read('san-01');
      assert.deepEqual(publicSnapshot.summary, afterVoid.summary);
      assert.equal(
        publicSnapshot.orders
          .flatMap((order) => order.lines)
          .find((line) => line.id === timeLine.id)?.lineKind,
        'MANUAL_TIME',
      );

      const activityResult = await database.pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM activity_logs
          WHERE action IN (
            'bill.custom_charge_added',
            'bill.custom_charge_updated',
            'bill.custom_charge_voided'
          )
        `,
      );
      assert.equal(Number(activityResult.rows[0]?.count), 4);

      console.log('Admin custom charges database verification PASS.');
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
            activityLogs: Number(activityResult.rows[0]?.count),
          },
          null,
          2,
        ),
      );
    } finally {
      await database.pool.end();
    }
  } finally {
    await dropVerificationDatabase(adminClient, verificationDatabase);
    await adminClient.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
