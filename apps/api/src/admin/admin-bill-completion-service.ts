import {
  adminRealtimeEventSchema,
  completeAdminBillResponseSchema,
  type AdminRealtimeEvent,
  type CompleteAdminBillResponse,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';

export type AdminBillCompletionErrorCode =
  | 'ADMIN_BILL_NOT_FOUND'
  | 'ADMIN_BILL_NOT_OPEN'
  | 'BILL_HAS_UNRESOLVED_ORDERS'
  | 'BILL_HAS_OUTSTANDING_SETTLEMENTS'
  | 'BILL_TOTAL_TOO_LARGE';

export class AdminBillCompletionDomainError extends Error {
  constructor(
    readonly code: AdminBillCompletionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminBillCompletionDomainError';
  }
}

export interface AdminBillCompletionService {
  completeBill(command: {
    adminUserId: string;
    billId: string;
  }): Promise<CompleteAdminBillResponse>;
}

interface BillReferenceRow extends QueryResultRow {
  service_point_id: string;
}

interface LockedBillRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
}

interface CountRow extends QueryResultRow {
  count: string;
}

interface CompletedBillRow extends QueryResultRow {
  id: string;
  service_point_id: string;
  total_vnd: number;
  completed_at: Date;
}

const maximumMoneyVnd = 2_147_483_647;

async function acquireTransactionLock(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

function publishBestEffort(
  eventPublisher: OrderCreatedEventPublisher | undefined,
  event: AdminRealtimeEvent,
): void {
  if (!eventPublisher) {
    return;
  }

  try {
    eventPublisher.publish(event);
  } catch {
    // Realtime delivery is advisory and must not roll back a committed bill completion.
  }
}

export function createAdminBillCompletionService(
  pool: Pool,
  eventPublisher?: OrderCreatedEventPublisher,
): AdminBillCompletionService {
  return {
    async completeBill(command) {
      const result = await withTransaction(pool, async (client) => {
        const referenceResult = await client.query<BillReferenceRow>(
          `
            SELECT service_point_id
            FROM bills
            WHERE id = $1
            LIMIT 1
          `,
          [command.billId],
        );
        const reference = referenceResult.rows[0];

        if (!reference) {
          throw new AdminBillCompletionDomainError('ADMIN_BILL_NOT_FOUND', 'Không tìm thấy bill.');
        }

        // Serialize completion with customer order creation for the same court.
        await acquireTransactionLock(client, `open-bill:${reference.service_point_id}`);
        // Serialize completion with every Step 7 mutation on this bill.
        await acquireTransactionLock(client, `bill:${command.billId}`);

        const billResult = await client.query<LockedBillRow>(
          `
            SELECT id, venue_id, service_point_id, status
            FROM bills
            WHERE id = $1
            FOR UPDATE
          `,
          [command.billId],
        );
        const bill = billResult.rows[0];

        if (!bill) {
          throw new AdminBillCompletionDomainError('ADMIN_BILL_NOT_FOUND', 'Không tìm thấy bill.');
        }

        if (bill.status !== 'OPEN') {
          throw new AdminBillCompletionDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để hoàn tất.',
          );
        }

        const unresolvedResult = await client.query<CountRow>(
          `
            SELECT COUNT(*)::text AS count
            FROM orders
            WHERE bill_id = $1
              AND status IN ('PENDING', 'ACCEPTED')
          `,
          [bill.id],
        );
        const unresolvedCount = Number(unresolvedResult.rows[0]?.count ?? 0);

        if (unresolvedCount > 0) {
          throw new AdminBillCompletionDomainError(
            'BILL_HAS_UNRESOLVED_ORDERS',
            'Bill còn order đang chờ hoặc chưa phục vụ.',
          );
        }

        const outstandingResult = await client.query<CountRow>(
          `
            WITH allocations AS (
              SELECT
                order_lines.id,
                order_lines.quantity,
                COALESCE(
                  SUM(order_line_settlements.quantity)
                    FILTER (WHERE order_line_settlements.status = 'ACTIVE'),
                  0
                )::integer AS allocated_quantity
              FROM order_lines
              LEFT JOIN order_line_settlements
                ON order_line_settlements.order_line_id = order_lines.id
              WHERE order_lines.bill_id = $1
                AND order_lines.status = 'ACTIVE'
              GROUP BY order_lines.id, order_lines.quantity
            )
            SELECT COUNT(*)::text AS count
            FROM allocations
            WHERE allocated_quantity <> quantity
          `,
          [bill.id],
        );
        const outstandingCount = Number(outstandingResult.rows[0]?.count ?? 0);

        if (outstandingCount > 0) {
          throw new AdminBillCompletionDomainError(
            'BILL_HAS_OUTSTANDING_SETTLEMENTS',
            'Bill còn line chưa được đánh dấu PAID hoặc WAIVED đầy đủ.',
          );
        }

        const completedResult = await client.query<CompletedBillRow>(
          `
            WITH totals AS (
              SELECT COALESCE(SUM(line_total_vnd), 0)::bigint AS total_vnd
              FROM order_lines
              WHERE bill_id = $1 AND status = 'ACTIVE'
            )
            UPDATE bills
            SET subtotal_vnd = totals.total_vnd::integer,
                total_vnd = totals.total_vnd::integer,
                status = 'COMPLETED',
                completed_at = now(),
                updated_at = now()
            FROM totals
            WHERE bills.id = $1
              AND bills.status = 'OPEN'
              AND totals.total_vnd <= $2
            RETURNING bills.id, bills.service_point_id, bills.total_vnd, bills.completed_at
          `,
          [bill.id, maximumMoneyVnd],
        );
        const completed = completedResult.rows[0];

        if (!completed) {
          throw new AdminBillCompletionDomainError(
            'BILL_TOTAL_TOO_LARGE',
            'Tổng tiền bill vượt giới hạn hệ thống.',
          );
        }

        await client.query(
          `
            INSERT INTO activity_logs (
              venue_id,
              actor_type,
              actor_admin_user_id,
              action,
              entity_type,
              entity_id,
              metadata
            )
            VALUES ($1, 'ADMIN', $2, 'bill.completed', 'bill', $3, $4::jsonb)
          `,
          [
            bill.venue_id,
            command.adminUserId,
            bill.id,
            JSON.stringify({
              servicePointId: bill.service_point_id,
              totalVnd: completed.total_vnd,
            }),
          ],
        );

        const response = completeAdminBillResponseSchema.parse({
          billId: completed.id,
          servicePointId: completed.service_point_id,
          status: 'COMPLETED',
          totalVnd: completed.total_vnd,
          completedAt: completed.completed_at.toISOString(),
        });
        const event = adminRealtimeEventSchema.parse({
          type: 'bill.completed',
          servicePointId: completed.service_point_id,
          billId: completed.id,
        });

        return { response, event };
      });

      publishBestEffort(eventPublisher, result.event);
      return result.response;
    },
  };
}
