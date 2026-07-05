import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import {
  AdminBillCompletionDomainError,
  createAdminBillCompletionService,
} from '../admin/admin-bill-completion-service.js';
import { createAdminOrderOperationsService } from '../admin/admin-order-operations-service.js';
import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createOrderService } from '../order/create-order-service.js';
import { createPublicCurrentBillService } from '../public-bill/public-current-bill-service.js';
import {
  AdminSettlementDomainError,
  createAdminSettlementService,
} from '../settlement/admin-settlement-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/u);
  return `"${identifier}"`;
}

function rejectedReason(result: PromiseSettledResult<unknown>): unknown {
  assert.equal(result.status, 'rejected');
  return result.reason;
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
}

async function main(): Promise<void> {
  const pgOverlapWarnings: string[] = [];
  const warningListener = (warning: Error): void => {
    if (
      warning.name === 'DeprecationWarning' &&
      warning.message.includes('client.query() when the client is already executing a query')
    ) {
      pgOverlapWarnings.push(warning.message);
    }
  };
  process.on('warning', warningListener);

  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_step10pro_e_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);

  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step10pro-e-admin-verifier',
  });
  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());

    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step10pro-e-verifier',
      maxConnections: 12,
    });

    try {
      const orderService = createOrderService(database.pool);
      const operations = createAdminOrderOperationsService(database.pool);
      const settlements = createAdminSettlementService(database.pool, (billId) =>
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

      const firstOrder = await orderService.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 5 }],
        },
      });
      await operations.updateOrderStatus({
        adminUserId,
        orderId: firstOrder.order.id,
        request: { status: 'ACCEPTED' },
      });

      const firstDetail = await operations.readBill(firstOrder.bill.id);
      assert.ok(firstDetail);
      const firstLine = firstDetail.orders
        .flatMap((order) => order.lines)
        .find((line) => line.catalogItemId === item.id);
      assert.ok(firstLine);

      const competingAllocations = await Promise.allSettled([
        settlements.create({
          adminUserId,
          lineId: firstLine.id,
          request: { idempotencyKey: randomUUID(), type: 'PAID', quantity: 4 },
        }),
        settlements.create({
          adminUserId,
          lineId: firstLine.id,
          request: {
            idempotencyKey: randomUUID(),
            type: 'WAIVED',
            quantity: 4,
            reason: 'Race test',
          },
        }),
      ]);
      const allocationWinners = competingAllocations.filter(
        (result) => result.status === 'fulfilled',
      );
      const allocationLosers = competingAllocations.filter(
        (result) => result.status === 'rejected',
      );
      assert.equal(allocationWinners.length, 1);
      assert.equal(allocationLosers.length, 1);
      assert.ok(rejectedReason(allocationLosers[0]!) instanceof AdminSettlementDomainError);
      assert.equal(
        (rejectedReason(allocationLosers[0]!) as AdminSettlementDomainError).code,
        'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING',
      );

      const firstActiveQuantityResult = await database.pool.query<{ quantity: string }>(
        `
          SELECT COALESCE(SUM(quantity), 0)::text AS quantity
          FROM order_line_settlements
          WHERE order_line_id = $1 AND status = 'ACTIVE'
        `,
        [firstLine.id],
      );
      assert.equal(Number(firstActiveQuantityResult.rows[0]?.quantity), 4);

      const secondOrder = await orderService.create({
        servicePointSlug: 'san-01',
        request: {
          idempotencyKey: randomUUID(),
          items: [{ catalogItemId: item.id, quantity: 2 }],
        },
      });
      await operations.updateOrderStatus({
        adminUserId,
        orderId: secondOrder.order.id,
        request: { status: 'ACCEPTED' },
      });

      const secondDetail = await operations.readBill(firstOrder.bill.id);
      assert.ok(secondDetail);
      const secondLine = secondDetail.orders
        .find((order) => order.id === secondOrder.order.id)
        ?.lines.find((line) => line.catalogItemId === item.id);
      assert.ok(secondLine);

      const sharedIdempotencyKey = randomUUID();
      const exactReplayRace = await Promise.all([
        settlements.create({
          adminUserId,
          lineId: secondLine.id,
          request: { idempotencyKey: sharedIdempotencyKey, type: 'PAID', quantity: 1 },
        }),
        settlements.create({
          adminUserId,
          lineId: secondLine.id,
          request: { idempotencyKey: sharedIdempotencyKey, type: 'PAID', quantity: 1 },
        }),
      ]);
      assert.equal(exactReplayRace.length, 2);

      const replayCountResult = await database.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM order_line_settlements WHERE idempotency_key = $1`,
        [`admin:settlement:${sharedIdempotencyKey}`],
      );
      assert.equal(Number(replayCountResult.rows[0]?.count), 1);

      await settlements.create({
        adminUserId,
        lineId: firstLine.id,
        request: { idempotencyKey: randomUUID(), type: 'PAID', quantity: 1 },
      });
      await settlements.create({
        adminUserId,
        lineId: secondLine.id,
        request: { idempotencyKey: randomUUID(), type: 'WAIVED', quantity: 1, reason: 'Race test' },
      });

      await operations.updateOrderStatus({
        adminUserId,
        orderId: firstOrder.order.id,
        request: { status: 'SERVED' },
      });
      await operations.updateOrderStatus({
        adminUserId,
        orderId: secondOrder.order.id,
        request: { status: 'SERVED' },
      });

      const fullyAllocated = await operations.readBill(firstOrder.bill.id);
      assert.ok(fullyAllocated);
      assert.equal(fullyAllocated.summary.outstandingTotalVnd, 0);
      const publicSnapshot = await publicBill.read('san-01');
      assert.deepEqual(publicSnapshot.summary, fullyAllocated.summary);

      const largeSettlement = fullyAllocated.orders
        .flatMap((order) => order.lines)
        .find((line) => line.id === firstLine.id)
        ?.settlements.find(
          (settlement) => settlement.status === 'ACTIVE' && settlement.quantity === 4,
        );
      assert.ok(largeSettlement);

      const completionRace = await Promise.allSettled([
        settlements
          .reverse({
            adminUserId,
            settlementId: largeSettlement.id,
            request: { idempotencyKey: randomUUID(), reason: 'Concurrency hardening test' },
          })
          .then(() => 'reverse' as const),
        billCompletion
          .completeBill({ adminUserId, billId: firstOrder.bill.id })
          .then(() => 'complete' as const),
      ]);
      const raceWinners = completionRace.filter((result) => result.status === 'fulfilled');
      const raceLosers = completionRace.filter((result) => result.status === 'rejected');
      assert.equal(raceWinners.length, 1);
      assert.equal(raceLosers.length, 1);

      const winner = raceWinners[0]!.status === 'fulfilled' ? raceWinners[0]!.value : null;
      const loser = rejectedReason(raceLosers[0]!);

      if (winner === 'reverse') {
        assert.ok(loser instanceof AdminBillCompletionDomainError);
        assert.equal(loser.code, 'BILL_HAS_OUTSTANDING_SETTLEMENTS');
        await settlements.create({
          adminUserId,
          lineId: firstLine.id,
          request: { idempotencyKey: randomUUID(), type: 'PAID', quantity: 4 },
        });
        await billCompletion.completeBill({ adminUserId, billId: firstOrder.bill.id });
      } else {
        assert.equal(winner, 'complete');
        assert.ok(loser instanceof AdminSettlementDomainError);
        assert.equal(loser.code, 'ADMIN_BILL_NOT_OPEN');
      }

      const finalBillResult = await database.pool.query<{ status: string }>(
        `SELECT status FROM bills WHERE id = $1`,
        [firstOrder.bill.id],
      );
      assert.equal(finalBillResult.rows[0]?.status, 'COMPLETED');

      await nextTurn();
      assert.deepEqual(pgOverlapWarnings, []);

      console.log('Step 10.PRO completion hardening database verification PASS.');
      console.log(
        JSON.stringify(
          {
            overlappingPoolClientWarnings: 0,
            competingAllocationSerialized: true,
            overAllocationRaceRejected: true,
            concurrentIdempotentReplaySingleRow: true,
            reverseVsCompletionSerialized: true,
            adminAndPublicSummaryMatch: true,
            finalBillCompleted: true,
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
    process.off('warning', warningListener);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
