import { randomUUID } from 'node:crypto';

import {
  adminBillDetailResponseSchema,
  adminRealtimeEventSchema,
  type AddAdminBillItemRequest,
  type AdminBillDetailResponse,
  type AdminRealtimeEvent,
  type UpdateAdminOrderLineRequest,
  type UpdateAdminOrderStatusRequest,
  type VoidAdminOrderLineRequest,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { buildBillProjection } from '../bill-projection/build-bill-projection.js';
import { buildLineSettlementStateMap } from '../bill-projection/settlement-state.js';
import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';

export type AdminOrderOperationErrorCode =
  | 'ADMIN_BILL_NOT_FOUND'
  | 'ADMIN_ORDER_NOT_FOUND'
  | 'ADMIN_ORDER_LINE_NOT_FOUND'
  | 'ADMIN_CATALOG_ITEM_UNAVAILABLE'
  | 'ADMIN_BILL_NOT_OPEN'
  | 'INVALID_ORDER_TRANSITION'
  | 'ORDER_LINE_NOT_EDITABLE'
  | 'ORDER_LINE_ALREADY_VOIDED'
  | 'ORDER_LINE_HAS_ACTIVE_SETTLEMENTS'
  | 'ORDER_HAS_ACTIVE_SETTLEMENTS'
  | 'ORDER_TOTAL_TOO_LARGE';

export class AdminOrderOperationDomainError extends Error {
  constructor(
    readonly code: AdminOrderOperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminOrderOperationDomainError';
  }
}

export interface AdminOrderOperationsService {
  readBill(billId: string): Promise<AdminBillDetailResponse | null>;
  updateOrderStatus(command: {
    adminUserId: string;
    orderId: string;
    request: UpdateAdminOrderStatusRequest;
  }): Promise<AdminBillDetailResponse>;
  addBillItem(command: {
    adminUserId: string;
    billId: string;
    request: AddAdminBillItemRequest;
  }): Promise<AdminBillDetailResponse>;
  updateOrderLine(command: {
    adminUserId: string;
    lineId: string;
    request: UpdateAdminOrderLineRequest;
  }): Promise<AdminBillDetailResponse>;
  voidOrderLine(command: {
    adminUserId: string;
    lineId: string;
    request: VoidAdminOrderLineRequest;
  }): Promise<AdminBillDetailResponse>;
}

interface BillHeaderRow extends QueryResultRow {
  bill_id: string;
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  subtotal_vnd: number;
  total_vnd: number;
  opened_at: Date;
  updated_at: Date;
  venue_id: string;
  venue_name: string;
  service_point_id: string;
  service_point_code: string;
  service_point_name: string;
  service_point_slug: string;
}

interface BillOrderRow extends QueryResultRow {
  id: string;
  idempotency_key: string;
  status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  note: string | null;
  total_vnd: number;
  accepted_at: Date | null;
  served_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  created_at: Date;
}

interface BillLineRow extends QueryResultRow {
  id: string;
  order_id: string;
  line_kind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  catalog_item_id: string | null;
  item_name_snapshot: string;
  unit_name_snapshot: string;
  image_public_id_snapshot: string | null;
  unit_price_snapshot_vnd: number;
  quantity: number;
  duration_minutes: number | null;
  billing_interval_minutes: number | null;
  line_total_vnd: number;
  status: 'ACTIVE' | 'VOIDED';
  void_reason: string | null;
  voided_at: Date | null;
  created_at: Date;
}

interface BillSettlementRow extends QueryResultRow {
  id: string;
  order_line_id: string;
  settlement_type: 'PAID' | 'WAIVED';
  quantity: number;
  unit_price_snapshot_vnd: number;
  amount_vnd: number;
  reason: string | null;
  status: 'ACTIVE' | 'REVERSED';
  created_by_admin_user_id: string;
  reversed_by_admin_user_id: string | null;
  reversal_reason: string | null;
  reversed_at: Date | null;
  created_at: Date;
}

interface EntityBillRow extends QueryResultRow {
  bill_id: string;
}

interface LockedOrderRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  bill_id: string;
  status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
}

interface LockedLineRow extends QueryResultRow {
  id: string;
  order_id: string;
  bill_id: string;
  venue_id: string;
  service_point_id: string;
  line_kind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  line_status: 'ACTIVE' | 'VOIDED';
  order_status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  quantity: number;
  unit_price_snapshot_vnd: number;
}

interface LockedBillRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
}

interface CatalogItemRow extends QueryResultRow {
  id: string;
  name: string;
  unit_name: string;
  price_vnd: number;
  image_public_id: string | null;
}

const maximumMoneyVnd = 2_147_483_647;

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

async function acquireBillLock(client: PoolClient, billId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`bill:${billId}`]);
}

async function hasActiveSettlementsForLine(client: PoolClient, lineId: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean } & QueryResultRow>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM order_line_settlements
        WHERE order_line_id = $1 AND status = 'ACTIVE'
      ) AS exists
    `,
    [lineId],
  );

  return result.rows[0]?.exists ?? false;
}

async function hasActiveSettlementsForOrder(client: PoolClient, orderId: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean } & QueryResultRow>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM order_line_settlements
        INNER JOIN order_lines ON order_lines.id = order_line_settlements.order_line_id
        WHERE order_lines.order_id = $1
          AND order_line_settlements.status = 'ACTIVE'
      ) AS exists
    `,
    [orderId],
  );

  return result.rows[0]?.exists ?? false;
}

async function readBillDetail(
  executor: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  billId: string,
): Promise<AdminBillDetailResponse | null> {
  const headerResult = await executor.query<BillHeaderRow>(
    `
      SELECT
        bills.id AS bill_id,
        bills.status AS bill_status,
        bills.subtotal_vnd,
        bills.total_vnd,
        bills.opened_at,
        bills.updated_at,
        venues.id AS venue_id,
        venues.name AS venue_name,
        service_points.id AS service_point_id,
        service_points.code AS service_point_code,
        service_points.name AS service_point_name,
        service_points.slug AS service_point_slug
      FROM bills
      INNER JOIN venues ON venues.id = bills.venue_id
      INNER JOIN service_points ON service_points.id = bills.service_point_id
      WHERE bills.id = $1
      LIMIT 1
    `,
    [billId],
  );
  const header = headerResult.rows[0];

  if (!header) {
    return null;
  }

  // A PoolClient can execute only one query at a time. Keep these reads sequential so
  // repeatable-read snapshots never rely on pg's deprecated overlapping-query queue.
  const ordersResult = await executor.query<BillOrderRow>(
    `
      SELECT
        id,
        idempotency_key,
        status,
        note,
        total_vnd,
        accepted_at,
        served_at,
        cancelled_at,
        cancellation_reason,
        created_at
      FROM orders
      WHERE bill_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [billId],
  );
  const linesResult = await executor.query<BillLineRow>(
    `
      SELECT
        id,
        order_id,
        line_kind,
        catalog_item_id,
        item_name_snapshot,
        unit_name_snapshot,
        image_public_id_snapshot,
        unit_price_snapshot_vnd,
        quantity,
        duration_minutes,
        billing_interval_minutes,
        line_total_vnd,
        status,
        void_reason,
        voided_at,
        created_at
      FROM order_lines
      WHERE bill_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [billId],
  );
  const settlementsResult = await executor.query<BillSettlementRow>(
    `
      SELECT
        id,
        order_line_id,
        settlement_type,
        quantity,
        unit_price_snapshot_vnd,
        amount_vnd,
        reason,
        status,
        created_by_admin_user_id,
        reversed_by_admin_user_id,
        reversal_reason,
        reversed_at,
        created_at
      FROM order_line_settlements
      WHERE bill_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [billId],
  );

  const linesByOrder = new Map<string, BillLineRow[]>();
  const settlementsByLine = new Map<string, BillSettlementRow[]>();

  for (const line of linesResult.rows) {
    const current = linesByOrder.get(line.order_id) ?? [];
    current.push(line);
    linesByOrder.set(line.order_id, current);
  }

  for (const settlement of settlementsResult.rows) {
    const current = settlementsByLine.get(settlement.order_line_id) ?? [];
    current.push(settlement);
    settlementsByLine.set(settlement.order_line_id, current);
  }

  const settlementStateByLine = buildLineSettlementStateMap({
    lines: linesResult.rows.map((line) => ({
      id: line.id,
      unitPriceVnd: line.unit_price_snapshot_vnd,
      quantity: line.quantity,
    })),
    settlements: settlementsResult.rows.map((settlement) => ({
      id: settlement.id,
      lineId: settlement.order_line_id,
      type: settlement.settlement_type,
      status: settlement.status,
      quantity: settlement.quantity,
      amountVnd: settlement.amount_vnd,
    })),
  });

  const summary = buildBillProjection({
    orders: ordersResult.rows.map((order) => ({ id: order.id, status: order.status })),
    lines: linesResult.rows.map((line) => ({
      id: line.id,
      orderId: line.order_id,
      lineKind: line.line_kind,
      catalogItemId: line.catalog_item_id,
      itemName: line.item_name_snapshot,
      unitName: line.unit_name_snapshot,
      imagePublicId: line.image_public_id_snapshot,
      unitPriceVnd: line.unit_price_snapshot_vnd,
      quantity: line.quantity,
      lineTotalVnd: line.line_total_vnd,
      status: line.status,
      createdAt: line.created_at,
    })),
    settlements: settlementsResult.rows.map((settlement) => ({
      id: settlement.id,
      lineId: settlement.order_line_id,
      type: settlement.settlement_type,
      status: settlement.status,
      quantity: settlement.quantity,
      amountVnd: settlement.amount_vnd,
    })),
  });

  return adminBillDetailResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    venue: {
      id: header.venue_id,
      name: header.venue_name,
    },
    servicePoint: {
      id: header.service_point_id,
      code: header.service_point_code,
      name: header.service_point_name,
      slug: header.service_point_slug,
    },
    bill: {
      id: header.bill_id,
      status: header.bill_status,
      subtotalVnd: header.subtotal_vnd,
      totalVnd: header.total_vnd,
      openedAt: header.opened_at.toISOString(),
      updatedAt: header.updated_at.toISOString(),
    },
    summary,
    orders: ordersResult.rows.map((order) => ({
      id: order.id,
      source: order.idempotency_key.startsWith('admin:') ? 'ADMIN' : 'CUSTOMER',
      status: order.status,
      note: order.note,
      totalVnd: order.total_vnd,
      acceptedAt: toIso(order.accepted_at),
      servedAt: toIso(order.served_at),
      cancelledAt: toIso(order.cancelled_at),
      cancellationReason: order.cancellation_reason,
      createdAt: order.created_at.toISOString(),
      lines: (linesByOrder.get(order.id) ?? []).map((line) => {
        const settlementState = settlementStateByLine.get(line.id);

        if (!settlementState) {
          throw new Error(`Settlement state missing for line ${line.id}.`);
        }

        return {
          id: line.id,
          lineKind: line.line_kind,
          catalogItemId: line.catalog_item_id,
          itemName: line.item_name_snapshot,
          unitName: line.unit_name_snapshot,
          imagePublicId: line.image_public_id_snapshot,
          unitPriceVnd: line.unit_price_snapshot_vnd,
          quantity: line.quantity,
          durationMinutes: line.duration_minutes,
          billingIntervalMinutes: line.billing_interval_minutes,
          lineTotalVnd: line.line_total_vnd,
          ...settlementState,
          settlements: (settlementsByLine.get(line.id) ?? []).map((settlement) => ({
            id: settlement.id,
            type: settlement.settlement_type,
            quantity: settlement.quantity,
            unitPriceVnd: settlement.unit_price_snapshot_vnd,
            amountVnd: settlement.amount_vnd,
            reason: settlement.reason,
            status: settlement.status,
            createdByAdminUserId: settlement.created_by_admin_user_id,
            reversedByAdminUserId: settlement.reversed_by_admin_user_id,
            reversalReason: settlement.reversal_reason,
            reversedAt: toIso(settlement.reversed_at),
            createdAt: settlement.created_at.toISOString(),
          })),
          status: line.status,
          voidReason: line.void_reason,
          voidedAt: toIso(line.voided_at),
          createdAt: line.created_at.toISOString(),
        };
      }),
    })),
  });
}

async function requireBillIdForOrder(client: PoolClient, orderId: string): Promise<string> {
  const result = await client.query<EntityBillRow>(
    'SELECT bill_id FROM orders WHERE id = $1 LIMIT 1',
    [orderId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new AdminOrderOperationDomainError('ADMIN_ORDER_NOT_FOUND', 'Không tìm thấy order.');
  }

  return row.bill_id;
}

async function requireBillIdForLine(client: PoolClient, lineId: string): Promise<string> {
  const result = await client.query<EntityBillRow>(
    'SELECT bill_id FROM order_lines WHERE id = $1 LIMIT 1',
    [lineId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new AdminOrderOperationDomainError(
      'ADMIN_ORDER_LINE_NOT_FOUND',
      'Không tìm thấy order line.',
    );
  }

  return row.bill_id;
}

async function recalculateOrderAndBill(
  client: PoolClient,
  orderId: string,
  billId: string,
): Promise<void> {
  const orderResult = await client.query<{ total_vnd: number } & QueryResultRow>(
    `
      WITH totals AS (
        SELECT COALESCE(SUM(line_total_vnd), 0)::bigint AS total_vnd
        FROM order_lines
        WHERE order_id = $1 AND status = 'ACTIVE'
      )
      UPDATE orders
      SET total_vnd = totals.total_vnd::integer,
          updated_at = now()
      FROM totals
      WHERE orders.id = $1
        AND totals.total_vnd <= $2
      RETURNING orders.total_vnd
    `,
    [orderId, maximumMoneyVnd],
  );

  if (!orderResult.rows[0]) {
    throw new AdminOrderOperationDomainError(
      'ORDER_TOTAL_TOO_LARGE',
      'Tổng tiền order vượt giới hạn hệ thống.',
    );
  }

  const billResult = await client.query<{ total_vnd: number } & QueryResultRow>(
    `
      WITH totals AS (
        SELECT COALESCE(SUM(line_total_vnd), 0)::bigint AS total_vnd
        FROM order_lines
        WHERE bill_id = $1 AND status = 'ACTIVE'
      )
      UPDATE bills
      SET subtotal_vnd = totals.total_vnd::integer,
          total_vnd = totals.total_vnd::integer,
          updated_at = now()
      FROM totals
      WHERE bills.id = $1
        AND bills.status = 'OPEN'
        AND totals.total_vnd <= $2
      RETURNING bills.total_vnd
    `,
    [billId, maximumMoneyVnd],
  );

  if (!billResult.rows[0]) {
    throw new AdminOrderOperationDomainError(
      'ORDER_TOTAL_TOO_LARGE',
      'Tổng tiền bill vượt giới hạn hệ thống hoặc bill không còn mở.',
    );
  }
}

async function writeActivity(
  client: PoolClient,
  input: {
    venueId: string;
    adminUserId: string;
    action: string;
    entityType: string;
    entityId: string;
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
      VALUES ($1, 'ADMIN', $2, $3, $4, $5, $6::jsonb)
    `,
    [
      input.venueId,
      input.adminUserId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.metadata),
    ],
  );
}

function publishBestEffort(
  publisher: OrderCreatedEventPublisher | undefined,
  event: AdminRealtimeEvent,
): void {
  if (!publisher) {
    return;
  }

  try {
    publisher.publish(adminRealtimeEventSchema.parse(event));
  } catch {
    // Realtime is advisory; a committed operation must not be rolled back by delivery failure.
  }
}

export function createAdminOrderOperationsService(
  pool: Pool,
  eventPublisher?: OrderCreatedEventPublisher,
): AdminOrderOperationsService {
  return {
    readBill: (billId) =>
      withTransaction(pool, (client) => readBillDetail(client, billId), {
        isolationLevel: 'repeatable read',
        readOnly: true,
      }),

    async updateOrderStatus(command) {
      const result = await withTransaction(pool, async (client) => {
        const billId = await requireBillIdForOrder(client, command.orderId);
        await acquireBillLock(client, billId);

        const orderResult = await client.query<LockedOrderRow>(
          `
            SELECT
              orders.id,
              orders.venue_id,
              orders.service_point_id,
              orders.bill_id,
              orders.status,
              bills.status AS bill_status
            FROM orders
            INNER JOIN bills ON bills.id = orders.bill_id
            WHERE orders.id = $1
            FOR UPDATE OF orders, bills
          `,
          [command.orderId],
        );
        const order = orderResult.rows[0];

        if (!order) {
          throw new AdminOrderOperationDomainError(
            'ADMIN_ORDER_NOT_FOUND',
            'Không tìm thấy order.',
          );
        }

        if (order.bill_status !== 'OPEN') {
          throw new AdminOrderOperationDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để chỉnh sửa.',
          );
        }

        let action: 'order.accepted' | 'order.served' | 'order.cancelled';

        if (command.request.status === 'ACCEPTED') {
          if (order.status !== 'PENDING') {
            throw new AdminOrderOperationDomainError(
              'INVALID_ORDER_TRANSITION',
              'Chỉ order đang chờ mới có thể được chấp nhận.',
            );
          }

          await client.query(
            `
              UPDATE orders
              SET status = 'ACCEPTED',
                  accepted_at = now(),
                  updated_at = now()
              WHERE id = $1
            `,
            [order.id],
          );
          action = 'order.accepted';
        } else if (command.request.status === 'SERVED') {
          if (order.status !== 'ACCEPTED') {
            throw new AdminOrderOperationDomainError(
              'INVALID_ORDER_TRANSITION',
              'Chỉ order đã chấp nhận mới có thể được phục vụ.',
            );
          }

          await client.query(
            `
              UPDATE orders
              SET status = 'SERVED',
                  served_at = now(),
                  updated_at = now()
              WHERE id = $1
            `,
            [order.id],
          );
          action = 'order.served';
        } else {
          if (order.status !== 'PENDING' && order.status !== 'ACCEPTED') {
            throw new AdminOrderOperationDomainError(
              'INVALID_ORDER_TRANSITION',
              'Chỉ order đang chờ hoặc đã chấp nhận mới có thể hủy.',
            );
          }

          if (await hasActiveSettlementsForOrder(client, order.id)) {
            throw new AdminOrderOperationDomainError(
              'ORDER_HAS_ACTIVE_SETTLEMENTS',
              'Không thể hủy order còn settlement đang hoạt động.',
            );
          }

          await client.query(
            `
              UPDATE order_lines
              SET status = 'VOIDED',
                  void_reason = $2,
                  voided_at = now(),
                  updated_at = now()
              WHERE order_id = $1 AND status = 'ACTIVE'
            `,
            [order.id, command.request.reason],
          );

          await client.query(
            `
              UPDATE orders
              SET status = 'CANCELLED',
                  total_vnd = 0,
                  cancelled_at = now(),
                  cancellation_reason = $2,
                  updated_at = now()
              WHERE id = $1
            `,
            [order.id, command.request.reason],
          );

          await recalculateOrderAndBill(client, order.id, order.bill_id);
          action = 'order.cancelled';
        }

        await writeActivity(client, {
          venueId: order.venue_id,
          adminUserId: command.adminUserId,
          action,
          entityType: 'order',
          entityId: order.id,
          metadata: {
            billId: order.bill_id,
            servicePointId: order.service_point_id,
            status: command.request.status,
            ...(command.request.status === 'CANCELLED' ? { reason: command.request.reason } : {}),
          },
        });

        const detail = await readBillDetail(client, order.bill_id);

        if (!detail) {
          throw new Error('Updated bill could not be read back.');
        }

        return {
          detail,
          event: adminRealtimeEventSchema.parse({
            type: action,
            servicePointId: order.service_point_id,
            billId: order.bill_id,
            orderId: order.id,
          }),
        };
      });

      publishBestEffort(eventPublisher, result.event);
      return result.detail;
    },

    async addBillItem(command) {
      const result = await withTransaction(pool, async (client) => {
        await acquireBillLock(client, command.billId);

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
          throw new AdminOrderOperationDomainError('ADMIN_BILL_NOT_FOUND', 'Không tìm thấy bill.');
        }

        if (bill.status !== 'OPEN') {
          throw new AdminOrderOperationDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để thêm món.',
          );
        }

        const itemResult = await client.query<CatalogItemRow>(
          `
            SELECT id, name, unit_name, price_vnd, image_public_id
            FROM catalog_items
            WHERE id = $1
              AND venue_id = $2
              AND status = 'ACTIVE'
              AND is_available = true
            LIMIT 1
          `,
          [command.request.catalogItemId, bill.venue_id],
        );
        const item = itemResult.rows[0];

        if (!item) {
          throw new AdminOrderOperationDomainError(
            'ADMIN_CATALOG_ITEM_UNAVAILABLE',
            'Món không tồn tại hoặc hiện không còn bán.',
          );
        }

        const lineTotalVnd = item.price_vnd * command.request.quantity;

        if (!Number.isSafeInteger(lineTotalVnd) || lineTotalVnd > maximumMoneyVnd) {
          throw new AdminOrderOperationDomainError(
            'ORDER_TOTAL_TOO_LARGE',
            'Tổng tiền món vượt giới hạn hệ thống.',
          );
        }

        const orderResult = await client.query<{ id: string } & QueryResultRow>(
          `
            INSERT INTO orders (
              venue_id,
              service_point_id,
              bill_id,
              idempotency_key,
              status,
              note,
              total_vnd,
              accepted_at
            )
            VALUES ($1, $2, $3, $4, 'ACCEPTED', NULL, $5, now())
            RETURNING id
          `,
          [bill.venue_id, bill.service_point_id, bill.id, `admin:${randomUUID()}`, lineTotalVnd],
        );
        const order = orderResult.rows[0];

        if (!order) {
          throw new Error('PostgreSQL did not return the admin-created order.');
        }

        await client.query(
          `
            INSERT INTO order_lines (
              order_id,
              bill_id,
              catalog_item_id,
              item_name_snapshot,
              unit_name_snapshot,
              image_public_id_snapshot,
              unit_price_snapshot_vnd,
              quantity,
              line_total_vnd,
              status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
          `,
          [
            order.id,
            bill.id,
            item.id,
            item.name,
            item.unit_name,
            item.image_public_id,
            item.price_vnd,
            command.request.quantity,
            lineTotalVnd,
          ],
        );

        await recalculateOrderAndBill(client, order.id, bill.id);
        await writeActivity(client, {
          venueId: bill.venue_id,
          adminUserId: command.adminUserId,
          action: 'bill.item_added',
          entityType: 'order',
          entityId: order.id,
          metadata: {
            billId: bill.id,
            servicePointId: bill.service_point_id,
            catalogItemId: item.id,
            quantity: command.request.quantity,
            unitPriceVnd: item.price_vnd,
          },
        });

        const detail = await readBillDetail(client, bill.id);

        if (!detail) {
          throw new Error('Updated bill could not be read back.');
        }

        return {
          detail,
          event: adminRealtimeEventSchema.parse({
            type: 'bill.updated',
            servicePointId: bill.service_point_id,
            billId: bill.id,
            orderId: order.id,
          }),
        };
      });

      publishBestEffort(eventPublisher, result.event);
      return result.detail;
    },

    async updateOrderLine(command) {
      const result = await withTransaction(pool, async (client) => {
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
              order_lines.line_kind,
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
          throw new AdminOrderOperationDomainError(
            'ADMIN_ORDER_LINE_NOT_FOUND',
            'Không tìm thấy order line.',
          );
        }

        if (line.bill_status !== 'OPEN') {
          throw new AdminOrderOperationDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để chỉnh sửa.',
          );
        }

        if (await hasActiveSettlementsForLine(client, line.id)) {
          throw new AdminOrderOperationDomainError(
            'ORDER_LINE_HAS_ACTIVE_SETTLEMENTS',
            'Không thể sửa line còn settlement đang hoạt động.',
          );
        }

        if (
          line.line_kind !== 'CATALOG' ||
          line.line_status !== 'ACTIVE' ||
          (line.order_status !== 'PENDING' && line.order_status !== 'ACCEPTED')
        ) {
          throw new AdminOrderOperationDomainError(
            'ORDER_LINE_NOT_EDITABLE',
            'Chỉ line đang hoạt động trong order chưa phục vụ mới được đổi số lượng.',
          );
        }

        const lineTotalVnd = line.unit_price_snapshot_vnd * command.request.quantity;

        if (!Number.isSafeInteger(lineTotalVnd) || lineTotalVnd > maximumMoneyVnd) {
          throw new AdminOrderOperationDomainError(
            'ORDER_TOTAL_TOO_LARGE',
            'Tổng tiền order vượt giới hạn hệ thống.',
          );
        }

        await client.query(
          `
            UPDATE order_lines
            SET quantity = $2,
                line_total_vnd = $3,
                updated_at = now()
            WHERE id = $1
          `,
          [line.id, command.request.quantity, lineTotalVnd],
        );

        await recalculateOrderAndBill(client, line.order_id, line.bill_id);
        await writeActivity(client, {
          venueId: line.venue_id,
          adminUserId: command.adminUserId,
          action: 'order_line.quantity_updated',
          entityType: 'order_line',
          entityId: line.id,
          metadata: {
            billId: line.bill_id,
            orderId: line.order_id,
            previousQuantity: line.quantity,
            quantity: command.request.quantity,
          },
        });

        const detail = await readBillDetail(client, line.bill_id);

        if (!detail) {
          throw new Error('Updated bill could not be read back.');
        }

        return {
          detail,
          event: adminRealtimeEventSchema.parse({
            type: 'bill.updated',
            servicePointId: line.service_point_id,
            billId: line.bill_id,
            orderId: line.order_id,
          }),
        };
      });

      publishBestEffort(eventPublisher, result.event);
      return result.detail;
    },

    async voidOrderLine(command) {
      const result = await withTransaction(pool, async (client) => {
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
              order_lines.line_kind,
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
          throw new AdminOrderOperationDomainError(
            'ADMIN_ORDER_LINE_NOT_FOUND',
            'Không tìm thấy order line.',
          );
        }

        if (line.bill_status !== 'OPEN') {
          throw new AdminOrderOperationDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để chỉnh sửa.',
          );
        }

        if (await hasActiveSettlementsForLine(client, line.id)) {
          throw new AdminOrderOperationDomainError(
            'ORDER_LINE_HAS_ACTIVE_SETTLEMENTS',
            'Không thể void line còn settlement đang hoạt động.',
          );
        }

        if (line.line_kind !== 'CATALOG') {
          throw new AdminOrderOperationDomainError(
            'ORDER_LINE_NOT_EDITABLE',
            'Khoản phát sinh phải được void bằng API custom charge.',
          );
        }

        if (line.line_status === 'VOIDED') {
          throw new AdminOrderOperationDomainError(
            'ORDER_LINE_ALREADY_VOIDED',
            'Order line đã được void trước đó.',
          );
        }

        if (line.order_status === 'CANCELLED') {
          throw new AdminOrderOperationDomainError(
            'ORDER_LINE_NOT_EDITABLE',
            'Không thể void line của order đã hủy.',
          );
        }

        await client.query(
          `
            UPDATE order_lines
            SET status = 'VOIDED',
                void_reason = $2,
                voided_at = now(),
                updated_at = now()
            WHERE id = $1
          `,
          [line.id, command.request.reason],
        );

        await recalculateOrderAndBill(client, line.order_id, line.bill_id);
        await writeActivity(client, {
          venueId: line.venue_id,
          adminUserId: command.adminUserId,
          action: 'order_line.voided',
          entityType: 'order_line',
          entityId: line.id,
          metadata: {
            billId: line.bill_id,
            orderId: line.order_id,
            reason: command.request.reason,
          },
        });

        const detail = await readBillDetail(client, line.bill_id);

        if (!detail) {
          throw new Error('Updated bill could not be read back.');
        }

        return {
          detail,
          event: adminRealtimeEventSchema.parse({
            type: 'bill.updated',
            servicePointId: line.service_point_id,
            billId: line.bill_id,
            orderId: line.order_id,
          }),
        };
      });

      publishBestEffort(eventPublisher, result.event);
      return result.detail;
    },
  };
}
