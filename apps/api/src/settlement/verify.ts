import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import {
  AdminBillCompletionDomainError,
  createAdminBillCompletionService,
} from '../admin/admin-bill-completion-service.js';
import {
  AdminOrderOperationDomainError,
  createAdminOrderOperationsService,
} from '../admin/admin-order-operations-service.js';
import { readDatabaseEnvironment } from '../config/database-environment.js';
import {
  AdminCustomChargeDomainError,
  createAdminCustomChargeService,
} from '../custom-charge/admin-custom-charge-service.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import { createPublicCurrentBillService } from '../public-bill/public-current-bill-service.js';
import {
  AdminSettlementDomainError,
  createAdminSettlementService,
} from './admin-settlement-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_step10pro_d_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);

  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step10pro-d-admin-verifier',
  });
  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());

    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step10pro-d-verifier',
      maxConnections: 10,
    });

    try {
      const orderService = createOrderService(database.pool);
      const operations = createAdminOrderOperationsService(database.pool);
      const settlements = createAdminSettlementService(database.pool, (billId) =>
        operations.readBill(billId),
      );
      const customCharges = createAdminCustomChargeService(database.pool, (billId) =>
        operations.readBill(billId),
      );
      const billCompletion = createAdminBillCompletionService(database.pool);
      const publicBill = createPublicCurrentBillService(database.pool);

      const itemResult = await database.pool.query<{ id: string; price_vnd: number }>(
        `
          SELECT id, price_vnd
          FROM catalog_items
          WHERE status = 'ACTIVE' AND is_available = TRUE AND price_vnd > 0
          ORDER BY sort_order, id
          LIMIT 1
        `,
      );
      const item = itemResult.rows[0];
      assert.ok(item);

      const adminResult = await database.pool.query<{ id: string }>(
        `SELECT id FROM admin_users WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`,
      );
      const adminUserId = adminResult.rows[0]?.id;
      assert.ok(adminUserId);

      const created = await orderService.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 5 }],
        },
      });
      await operations.updateOrderStatus({
        adminUserId,
        orderId: created.order.id,
        request: { status: 'ACCEPTED' },
      });

      const initialDetail = await operations.readBill(created.bill.id);
      assert.ok(initialDetail);
      const line = initialDetail.orders
        .flatMap((order) => order.lines)
        .find((entry) => entry.catalogItemId === item.id);
      assert.ok(line);

      const paidKey = randomUUID();
      const afterPaid = await settlements.create({
        adminUserId,
        lineId: line.id,
        request: {
          idempotencyKey: paidKey,
          type: 'PAID',
          quantity: 2,
        },
      });
      assert.equal(afterPaid.summary.paidTotalVnd, item.price_vnd * 2);
      assert.equal(afterPaid.summary.waivedTotalVnd, 0);
      assert.equal(afterPaid.summary.outstandingTotalVnd, item.price_vnd * 3);

      const paidSettlement = afterPaid.orders
        .flatMap((order) => order.lines)
        .find((entry) => entry.id === line.id)
        ?.settlements.find((entry) => entry.type === 'PAID');
      assert.ok(paidSettlement);

      const replay = await settlements.create({
        adminUserId,
        lineId: line.id,
        request: {
          idempotencyKey: paidKey,
          type: 'PAID',
          quantity: 2,
        },
      });
      assert.equal(
        replay.orders
          .flatMap((order) => order.lines)
          .find((entry) => entry.id === line.id)
          ?.settlements.filter((entry) => entry.type === 'PAID').length,
        1,
      );

      await assert.rejects(
        settlements.create({
          adminUserId,
          lineId: line.id,
          request: {
            idempotencyKey: paidKey,
            type: 'PAID',
            quantity: 1,
          },
        }),
        (error: unknown) =>
          error instanceof AdminSettlementDomainError &&
          error.code === 'SETTLEMENT_IDEMPOTENCY_CONFLICT',
      );

      const afterWaived = await settlements.create({
        adminUserId,
        lineId: line.id,
        request: {
          idempotencyKey: randomUUID(),
          type: 'WAIVED',
          quantity: 1,
          reason: 'Khuyến mãi kiểm thử',
        },
      });
      assert.equal(afterWaived.summary.paidTotalVnd, item.price_vnd * 2);
      assert.equal(afterWaived.summary.waivedTotalVnd, item.price_vnd);
      assert.equal(afterWaived.summary.outstandingTotalVnd, item.price_vnd * 2);

      const waivedSettlement = afterWaived.orders
        .flatMap((order) => order.lines)
        .find((entry) => entry.id === line.id)
        ?.settlements.find((entry) => entry.type === 'WAIVED');
      assert.ok(waivedSettlement);

      await assert.rejects(
        settlements.create({
          adminUserId,
          lineId: line.id,
          request: {
            idempotencyKey: randomUUID(),
            type: 'PAID',
            quantity: 3,
          },
        }),
        (error: unknown) =>
          error instanceof AdminSettlementDomainError &&
          error.code === 'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING',
      );

      await assert.rejects(
        operations.updateOrderLine({
          adminUserId,
          lineId: line.id,
          request: { quantity: 6 },
        }),
        (error: unknown) =>
          error instanceof AdminOrderOperationDomainError &&
          error.code === 'ORDER_LINE_HAS_ACTIVE_SETTLEMENTS',
      );

      await assert.rejects(
        operations.voidOrderLine({
          adminUserId,
          lineId: line.id,
          request: { reason: 'Không dùng nữa' },
        }),
        (error: unknown) =>
          error instanceof AdminOrderOperationDomainError &&
          error.code === 'ORDER_LINE_HAS_ACTIVE_SETTLEMENTS',
      );

      await assert.rejects(
        operations.updateOrderStatus({
          adminUserId,
          orderId: created.order.id,
          request: { status: 'CANCELLED', reason: 'Khách đổi yêu cầu' },
        }),
        (error: unknown) =>
          error instanceof AdminOrderOperationDomainError &&
          error.code === 'ORDER_HAS_ACTIVE_SETTLEMENTS',
      );

      const reversePaidKey = randomUUID();
      const afterPaidReverse = await settlements.reverse({
        adminUserId,
        settlementId: paidSettlement.id,
        request: {
          idempotencyKey: reversePaidKey,
          reason: 'Ghi nhận thanh toán nhầm',
        },
      });
      assert.equal(afterPaidReverse.summary.paidTotalVnd, 0);
      assert.equal(afterPaidReverse.summary.waivedTotalVnd, item.price_vnd);
      assert.equal(afterPaidReverse.summary.outstandingTotalVnd, item.price_vnd * 4);

      const reverseReplay = await settlements.reverse({
        adminUserId,
        settlementId: paidSettlement.id,
        request: {
          idempotencyKey: reversePaidKey,
          reason: 'Ghi nhận thanh toán nhầm',
        },
      });
      assert.equal(reverseReplay.summary.paidTotalVnd, 0);

      await assert.rejects(
        settlements.reverse({
          adminUserId,
          settlementId: paidSettlement.id,
          request: {
            idempotencyKey: randomUUID(),
            reason: 'Lý do khác',
          },
        }),
        (error: unknown) =>
          error instanceof AdminSettlementDomainError &&
          error.code === 'SETTLEMENT_ALREADY_REVERSED',
      );

      await settlements.reverse({
        adminUserId,
        settlementId: waivedSettlement.id,
        request: {
          idempotencyKey: randomUUID(),
          reason: 'Hủy miễn phí kiểm thử',
        },
      });

      const afterEdit = await operations.updateOrderLine({
        adminUserId,
        lineId: line.id,
        request: { quantity: 6 },
      });
      const editedLine = afterEdit.orders
        .flatMap((order) => order.lines)
        .find((entry) => entry.id === line.id);
      assert.equal(editedLine?.quantity, 6);
      assert.equal(editedLine?.outstandingQuantity, 6);

      const customDetail = await customCharges.create({
        adminUserId,
        billId: created.bill.id,
        request: {
          kind: 'MANUAL_PRODUCT',
          idempotencyKey: randomUUID(),
          name: 'Phí khăn thuê',
          unitName: 'Cái',
          quantity: 2,
          unitPriceVnd: 15_000,
        },
      });
      const customLine = customDetail.orders
        .flatMap((order) => order.lines)
        .find((entry) => entry.lineKind === 'MANUAL_PRODUCT');
      assert.ok(customLine);

      await settlements.create({
        adminUserId,
        lineId: customLine.id,
        request: {
          idempotencyKey: randomUUID(),
          type: 'WAIVED',
          quantity: 1,
          reason: 'Miễn một khăn',
        },
      });

      await assert.rejects(
        customCharges.update({
          adminUserId,
          chargeId: customLine.id,
          request: {
            kind: 'MANUAL_PRODUCT',
            name: 'Phí khăn thuê',
            unitName: 'Cái',
            quantity: 3,
            unitPriceVnd: 10_000,
          },
        }),
        (error: unknown) =>
          error instanceof AdminCustomChargeDomainError &&
          error.code === 'CUSTOM_CHARGE_HAS_ACTIVE_SETTLEMENTS',
      );

      await assert.rejects(
        customCharges.void({
          adminUserId,
          chargeId: customLine.id,
          request: { reason: 'Thử void khoản đã settlement' },
        }),
        (error: unknown) =>
          error instanceof AdminCustomChargeDomainError &&
          error.code === 'CUSTOM_CHARGE_HAS_ACTIVE_SETTLEMENTS',
      );

      await operations.updateOrderStatus({
        adminUserId,
        orderId: created.order.id,
        request: { status: 'SERVED' },
      });

      const customOrder = customDetail.orders.find((order) =>
        order.lines.some((entry) => entry.id === customLine.id),
      );
      assert.ok(customOrder);
      await operations.updateOrderStatus({
        adminUserId,
        orderId: customOrder.id,
        request: { status: 'SERVED' },
      });

      await assert.rejects(
        billCompletion.completeBill({ adminUserId, billId: created.bill.id }),
        (error: unknown) =>
          error instanceof AdminBillCompletionDomainError &&
          error.code === 'BILL_HAS_OUTSTANDING_SETTLEMENTS',
      );

      await settlements.create({
        adminUserId,
        lineId: line.id,
        request: {
          idempotencyKey: randomUUID(),
          type: 'PAID',
          quantity: 6,
        },
      });
      await settlements.create({
        adminUserId,
        lineId: customLine.id,
        request: {
          idempotencyKey: randomUUID(),
          type: 'PAID',
          quantity: 1,
        },
      });

      const beforeCompletion = await operations.readBill(created.bill.id);
      assert.ok(beforeCompletion);
      assert.equal(beforeCompletion.summary.outstandingTotalVnd, 0);
      assert.equal(
        beforeCompletion.summary.items.reduce(
          (total, entry) => total + entry.outstandingQuantity,
          0,
        ),
        0,
      );

      const publicSnapshot = await publicBill.read('san-01');
      assert.deepEqual(publicSnapshot.summary, beforeCompletion.summary);

      const completed = await billCompletion.completeBill({
        adminUserId,
        billId: created.bill.id,
      });
      assert.equal(completed.status, 'COMPLETED');

      const settlementCountResult = await database.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM order_line_settlements WHERE bill_id = $1`,
        [created.bill.id],
      );
      const reversedCountResult = await database.pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM order_line_settlements
          WHERE bill_id = $1 AND status = 'REVERSED'
        `,
        [created.bill.id],
      );
      const activityResult = await database.pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM activity_logs
          WHERE action IN ('bill.settlement_created', 'bill.settlement_reversed')
        `,
      );

      assert.equal(Number(settlementCountResult.rows[0]?.count), 5);
      assert.equal(Number(reversedCountResult.rows[0]?.count), 2);
      assert.equal(Number(activityResult.rows[0]?.count), 7);

      console.log('Partial settlement database verification PASS.');
      console.log(
        JSON.stringify(
          {
            partialPaidQuantity: 2,
            partialWaivedQuantity: 1,
            overAllocationRejected: true,
            createIdempotencyVerified: true,
            reversalIdempotencyVerified: true,
            reversedSettlementsRetained: Number(reversedCountResult.rows[0]?.count),
            settledLineMutationBlocked: true,
            customChargeMutationBlocked: true,
            incompleteBillCompletionBlocked: true,
            publicAndAdminSummaryMatch: true,
            completedAfterFullAllocation: true,
            settlementActivityLogs: Number(activityResult.rows[0]?.count),
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
