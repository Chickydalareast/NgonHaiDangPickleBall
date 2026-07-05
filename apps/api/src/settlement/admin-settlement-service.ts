import {
  adminRealtimeEventSchema,
  type AdminBillDetailResponse,
  type AdminRealtimeEvent,
  type CreateAdminSettlementRequest,
  type ReverseAdminSettlementRequest,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';

const maximumMoneyVnd = 2_147_483_647;

export type AdminSettlementErrorCode =
  | 'ADMIN_ORDER_LINE_NOT_FOUND'
  | 'ADMIN_SETTLEMENT_NOT_FOUND'
  | 'ADMIN_BILL_NOT_OPEN'
  | 'ORDER_LINE_NOT_SETTLEABLE'
  | 'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING'
  | 'SETTLEMENT_IDEMPOTENCY_CONFLICT'
  | 'SETTLEMENT_ALREADY_REVERSED'
  | 'SETTLEMENT_REVERSAL_IDEMPOTENCY_CONFLICT'
  | 'SETTLEMENT_TOTAL_TOO_LARGE';

export class AdminSettlementDomainError extends Error {
  constructor(
    readonly code: AdminSettlementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminSettlementDomainError';
  }
}

export interface AdminSettlementService {
  create(command: {
    adminUserId: string;
    lineId: string;
    request: CreateAdminSettlementRequest;
  }): Promise<AdminBillDetailResponse>;
  reverse(command: {
    adminUserId: string;
    settlementId: string;
    request: ReverseAdminSettlementRequest;
  }): Promise<AdminBillDetailResponse>;
}

export type AdminBillReader = (billId: string) => Promise<AdminBillDetailResponse | null>;

interface EntityBillRow extends QueryResultRow {
  bill_id: string;
}

interface LockedLineRow extends QueryResultRow {
  id: string;
  order_id: string;
  bill_id: string;
  venue_id: string;
  service_point_id: string;
  line_status: 'ACTIVE' | 'VOIDED';
  order_status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  quantity: number;
  unit_price_snapshot_vnd: number;
}

interface ExistingSettlementRow extends QueryResultRow {
  id: string;
  bill_id: string;
  order_line_id: string;
  settlement_type: 'PAID' | 'WAIVED';
  quantity: number;
  reason: string | null;
}

interface ActiveQuantityRow extends QueryResultRow {
  allocated_quantity: string;
}

interface LockedSettlementRow extends QueryResultRow {
  id: string;
  bill_id: string;
  order_line_id: string;
  order_id: string;
  venue_id: string;
  service_point_id: string;
  status: 'ACTIVE' | 'REVERSED';
  reversal_idempotency_key: string | null;
  reversal_reason: string | null;
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
}

interface ReversalKeyRow extends QueryResultRow {
  id: string;
}

interface MutationResult {
  billId: string;
  servicePointId: string;
  orderId: string;
  publish: boolean;
}

async function acquireBillLock(client: PoolClient, billId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`bill:${billId}`]);
}

async function requireBillIdForLine(client: PoolClient, lineId: string): Promise<string> {
  const result = await client.query<EntityBillRow>(
    'SELECT bill_id FROM order_lines WHERE id = $1 LIMIT 1',
    [lineId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new AdminSettlementDomainError(
      'ADMIN_ORDER_LINE_NOT_FOUND',
      'Không tìm thấy order line.',
    );
  }

  return row.bill_id;
}

async function requireBillIdForSettlement(
  client: PoolClient,
  settlementId: string,
): Promise<string> {
  const result = await client.query<EntityBillRow>(
    'SELECT bill_id FROM order_line_settlements WHERE id = $1 LIMIT 1',
    [settlementId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new AdminSettlementDomainError(
      'ADMIN_SETTLEMENT_NOT_FOUND',
      'Không tìm thấy settlement.',
    );
  }

  return row.bill_id;
}

function requestReason(request: CreateAdminSettlementRequest): string | null {
  return request.type === 'WAIVED' ? request.reason : null;
}

function sameCreateRequest(
  existing: ExistingSettlementRow,
  lineId: string,
  request: CreateAdminSettlementRequest,
): boolean {
  return (
    existing.order_line_id === lineId &&
    existing.settlement_type === request.type &&
    existing.quantity === request.quantity &&
    existing.reason === requestReason(request)
  );
}

async function writeActivity(
  client: PoolClient,
  input: {
    venueId: string;
    adminUserId: string;
    action: 'bill.settlement_created' | 'bill.settlement_reversed';
    settlementId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
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
      VALUES ($1, 'ADMIN', $2, $3, 'order_line_settlement', $4, $5::jsonb)
    `,
    [
      input.venueId,
      input.adminUserId,
      input.action,
      input.settlementId,
      JSON.stringify(input.metadata),
    ],
  );
}

function publishBestEffort(
  publisher: OrderCreatedEventPublisher | undefined,
  event: AdminRealtimeEvent,
): void {
  if (!publisher) return;

  try {
    publisher.publish(adminRealtimeEventSchema.parse(event));
  } catch {
    // Realtime delivery is advisory after the database transaction commits.
  }
}

async function readBack(
  readBill: AdminBillReader,
  billId: string,
): Promise<AdminBillDetailResponse> {
  const detail = await readBill(billId);

  if (!detail) {
    throw new Error('Updated bill could not be read back.');
  }

  return detail;
}

export function createAdminSettlementService(
  pool: Pool,
  readBill: AdminBillReader,
  eventPublisher?: OrderCreatedEventPublisher,
): AdminSettlementService {
  return {
    async create(command) {
      const idempotencyKey = `admin:settlement:${command.request.idempotencyKey}`;
      const result = await withTransaction(pool, async (client): Promise<MutationResult> => {
        const billId = await requireBillIdForLine(client, command.lineId);
        await acquireBillLock(client, billId);

        const lineResult = await client.query<LockedLineRow>(
          `
            SELECT
              order_lines.id,
              order_lines.order_id,
              order_lines.bill_id,
              orders.venue_id,
              orders.service_point_id,
              order_lines.status AS line_status,
              orders.status AS order_status,
              bills.status AS bill_status,
              order_lines.quantity,
              order_lines.unit_price_snapshot_vnd
            FROM order_lines
            INNER JOIN orders ON orders.id = order_lines.order_id
            INNER JOIN bills ON bills.id = order_lines.bill_id
            WHERE order_lines.id = $1
            FOR UPDATE OF order_lines, orders, bills
          `,
          [command.lineId],
        );
        const line = lineResult.rows[0];

        if (!line) {
          throw new AdminSettlementDomainError(
            'ADMIN_ORDER_LINE_NOT_FOUND',
            'Không tìm thấy order line.',
          );
        }

        const existingResult = await client.query<ExistingSettlementRow>(
          `
            SELECT id, bill_id, order_line_id, settlement_type, quantity, reason
            FROM order_line_settlements
            WHERE idempotency_key = $1
            LIMIT 1
          `,
          [idempotencyKey],
        );
        const existing = existingResult.rows[0];

        if (existing) {
          if (
            existing.bill_id !== line.bill_id ||
            !sameCreateRequest(existing, line.id, command.request)
          ) {
            throw new AdminSettlementDomainError(
              'SETTLEMENT_IDEMPOTENCY_CONFLICT',
              'Idempotency key đã được dùng cho settlement khác.',
            );
          }

          return {
            billId: line.bill_id,
            servicePointId: line.service_point_id,
            orderId: line.order_id,
            publish: false,
          };
        }

        if (line.bill_status !== 'OPEN') {
          throw new AdminSettlementDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để settlement.',
          );
        }

        if (
          line.line_status !== 'ACTIVE' ||
          (line.order_status !== 'ACCEPTED' && line.order_status !== 'SERVED')
        ) {
          throw new AdminSettlementDomainError(
            'ORDER_LINE_NOT_SETTLEABLE',
            'Chỉ line đang hoạt động thuộc order đã chấp nhận hoặc đã phục vụ mới được settlement.',
          );
        }

        const allocatedResult = await client.query<ActiveQuantityRow>(
          `
            SELECT COALESCE(SUM(quantity), 0)::text AS allocated_quantity
            FROM order_line_settlements
            WHERE order_line_id = $1 AND status = 'ACTIVE'
          `,
          [line.id],
        );
        const allocatedQuantity = Number(allocatedResult.rows[0]?.allocated_quantity ?? 0);
        const outstandingQuantity = line.quantity - allocatedQuantity;

        if (command.request.quantity > outstandingQuantity) {
          throw new AdminSettlementDomainError(
            'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING',
            'Số lượng settlement vượt quá số lượng còn lại của line.',
          );
        }

        const amountVnd = line.unit_price_snapshot_vnd * command.request.quantity;

        if (!Number.isSafeInteger(amountVnd) || amountVnd > maximumMoneyVnd) {
          throw new AdminSettlementDomainError(
            'SETTLEMENT_TOTAL_TOO_LARGE',
            'Giá trị settlement vượt giới hạn hệ thống.',
          );
        }

        const insertedResult = await client.query<{ id: string } & QueryResultRow>(
          `
            INSERT INTO order_line_settlements (
              bill_id,
              order_line_id,
              settlement_type,
              quantity,
              unit_price_snapshot_vnd,
              amount_vnd,
              reason,
              idempotency_key,
              status,
              created_by_admin_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9)
            RETURNING id
          `,
          [
            line.bill_id,
            line.id,
            command.request.type,
            command.request.quantity,
            line.unit_price_snapshot_vnd,
            amountVnd,
            requestReason(command.request),
            idempotencyKey,
            command.adminUserId,
          ],
        );
        const inserted = insertedResult.rows[0];

        if (!inserted) {
          throw new Error('PostgreSQL did not return the created settlement.');
        }

        await client.query('UPDATE bills SET updated_at = now() WHERE id = $1', [line.bill_id]);
        await writeActivity(client, {
          venueId: line.venue_id,
          adminUserId: command.adminUserId,
          action: 'bill.settlement_created',
          settlementId: inserted.id,
          metadata: {
            billId: line.bill_id,
            orderId: line.order_id,
            orderLineId: line.id,
            servicePointId: line.service_point_id,
            type: command.request.type,
            quantity: command.request.quantity,
            unitPriceVnd: line.unit_price_snapshot_vnd,
            amountVnd,
            ...(command.request.type === 'WAIVED' ? { reason: command.request.reason } : {}),
          },
        });

        return {
          billId: line.bill_id,
          servicePointId: line.service_point_id,
          orderId: line.order_id,
          publish: true,
        };
      });

      const detail = await readBack(readBill, result.billId);

      if (result.publish) {
        publishBestEffort(eventPublisher, {
          type: 'bill.updated',
          servicePointId: result.servicePointId,
          billId: result.billId,
          orderId: result.orderId,
        });
      }

      return detail;
    },

    async reverse(command) {
      const reversalIdempotencyKey = `admin:settlement-reversal:${command.request.idempotencyKey}`;
      const result = await withTransaction(pool, async (client): Promise<MutationResult> => {
        const billId = await requireBillIdForSettlement(client, command.settlementId);
        await acquireBillLock(client, billId);

        const settlementResult = await client.query<LockedSettlementRow>(
          `
            SELECT
              order_line_settlements.id,
              order_line_settlements.bill_id,
              order_line_settlements.order_line_id,
              order_lines.order_id,
              orders.venue_id,
              orders.service_point_id,
              order_line_settlements.status,
              order_line_settlements.reversal_idempotency_key,
              order_line_settlements.reversal_reason,
              bills.status AS bill_status
            FROM order_line_settlements
            INNER JOIN order_lines ON order_lines.id = order_line_settlements.order_line_id
            INNER JOIN orders ON orders.id = order_lines.order_id
            INNER JOIN bills ON bills.id = order_line_settlements.bill_id
            WHERE order_line_settlements.id = $1
            FOR UPDATE OF order_line_settlements, order_lines, orders, bills
          `,
          [command.settlementId],
        );
        const settlement = settlementResult.rows[0];

        if (!settlement) {
          throw new AdminSettlementDomainError(
            'ADMIN_SETTLEMENT_NOT_FOUND',
            'Không tìm thấy settlement.',
          );
        }

        if (settlement.status === 'REVERSED') {
          if (
            settlement.reversal_idempotency_key === reversalIdempotencyKey &&
            settlement.reversal_reason === command.request.reason
          ) {
            return {
              billId: settlement.bill_id,
              servicePointId: settlement.service_point_id,
              orderId: settlement.order_id,
              publish: false,
            };
          }

          throw new AdminSettlementDomainError(
            'SETTLEMENT_ALREADY_REVERSED',
            'Settlement đã được reverse trước đó.',
          );
        }

        if (settlement.bill_status !== 'OPEN') {
          throw new AdminSettlementDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để reverse settlement.',
          );
        }

        const reversalKeyResult = await client.query<ReversalKeyRow>(
          `
            SELECT id
            FROM order_line_settlements
            WHERE reversal_idempotency_key = $1
            LIMIT 1
          `,
          [reversalIdempotencyKey],
        );
        const reversalKeyOwner = reversalKeyResult.rows[0];

        if (reversalKeyOwner && reversalKeyOwner.id !== settlement.id) {
          throw new AdminSettlementDomainError(
            'SETTLEMENT_REVERSAL_IDEMPOTENCY_CONFLICT',
            'Idempotency key đã được dùng để reverse settlement khác.',
          );
        }

        await client.query(
          `
            UPDATE order_line_settlements
            SET status = 'REVERSED',
                reversed_by_admin_user_id = $2,
                reversal_reason = $3,
                reversal_idempotency_key = $4,
                reversed_at = now(),
                updated_at = now()
            WHERE id = $1
          `,
          [settlement.id, command.adminUserId, command.request.reason, reversalIdempotencyKey],
        );

        await client.query('UPDATE bills SET updated_at = now() WHERE id = $1', [
          settlement.bill_id,
        ]);
        await writeActivity(client, {
          venueId: settlement.venue_id,
          adminUserId: command.adminUserId,
          action: 'bill.settlement_reversed',
          settlementId: settlement.id,
          metadata: {
            billId: settlement.bill_id,
            orderId: settlement.order_id,
            orderLineId: settlement.order_line_id,
            servicePointId: settlement.service_point_id,
            reason: command.request.reason,
          },
        });

        return {
          billId: settlement.bill_id,
          servicePointId: settlement.service_point_id,
          orderId: settlement.order_id,
          publish: true,
        };
      });

      const detail = await readBack(readBill, result.billId);

      if (result.publish) {
        publishBestEffort(eventPublisher, {
          type: 'bill.updated',
          servicePointId: result.servicePointId,
          billId: result.billId,
          orderId: result.orderId,
        });
      }

      return detail;
    },
  };
}
