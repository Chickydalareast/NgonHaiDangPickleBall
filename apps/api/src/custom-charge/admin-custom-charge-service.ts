import {
  adminRealtimeEventSchema,
  type AdminBillDetailResponse,
  type AdminRealtimeEvent,
  type CreateAdminCustomChargeRequest,
  type UpdateAdminCustomChargeRequest,
  type VoidAdminCustomChargeRequest,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';

const maximumMoneyVnd = 2_147_483_647;

export type AdminCustomChargeErrorCode =
  | 'ADMIN_BILL_NOT_FOUND'
  | 'ADMIN_BILL_NOT_OPEN'
  | 'ADMIN_CUSTOM_CHARGE_NOT_FOUND'
  | 'CUSTOM_CHARGE_KIND_IMMUTABLE'
  | 'CUSTOM_CHARGE_NOT_EDITABLE'
  | 'CUSTOM_CHARGE_ALREADY_VOIDED'
  | 'CUSTOM_CHARGE_HAS_ACTIVE_SETTLEMENTS'
  | 'CUSTOM_CHARGE_IDEMPOTENCY_CONFLICT'
  | 'CUSTOM_CHARGE_TOTAL_TOO_LARGE';

export class AdminCustomChargeDomainError extends Error {
  constructor(
    readonly code: AdminCustomChargeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminCustomChargeDomainError';
  }
}

export interface AdminCustomChargeService {
  create(command: {
    adminUserId: string;
    billId: string;
    request: CreateAdminCustomChargeRequest;
  }): Promise<AdminBillDetailResponse>;
  update(command: {
    adminUserId: string;
    chargeId: string;
    request: UpdateAdminCustomChargeRequest;
  }): Promise<AdminBillDetailResponse>;
  void(command: {
    adminUserId: string;
    chargeId: string;
    request: VoidAdminCustomChargeRequest;
  }): Promise<AdminBillDetailResponse>;
}

interface BillRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
}

interface ExistingChargeRow extends QueryResultRow {
  order_id: string;
  line_id: string;
  bill_id: string;
  line_kind: 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  item_name_snapshot: string;
  unit_name_snapshot: string;
  unit_price_snapshot_vnd: number;
  quantity: number;
  duration_minutes: number | null;
  billing_interval_minutes: number | null;
}

interface LockedChargeRow extends QueryResultRow {
  id: string;
  order_id: string;
  bill_id: string;
  venue_id: string;
  service_point_id: string;
  line_kind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  item_name_snapshot: string;
  unit_name_snapshot: string;
  unit_price_snapshot_vnd: number;
  quantity: number;
  duration_minutes: number | null;
  billing_interval_minutes: number | null;
  line_status: 'ACTIVE' | 'VOIDED';
  order_status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
}

interface ChargeSnapshot {
  kind: 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  name: string;
  unitName: string;
  unitPriceVnd: number;
  quantity: number;
  durationMinutes: number | null;
  billingIntervalMinutes: number | null;
  lineTotalVnd: number;
}

interface MutationResult {
  billId: string;
  servicePointId: string;
  orderId: string;
  publish: boolean;
}

export type AdminBillReader = (billId: string) => Promise<AdminBillDetailResponse | null>;

function toSnapshot(request: CreateAdminCustomChargeRequest | UpdateAdminCustomChargeRequest) {
  let snapshot: ChargeSnapshot;

  if (request.kind === 'MANUAL_PRODUCT') {
    snapshot = {
      kind: request.kind,
      name: request.name,
      unitName: request.unitName,
      unitPriceVnd: request.unitPriceVnd,
      quantity: request.quantity,
      durationMinutes: null,
      billingIntervalMinutes: null,
      lineTotalVnd: request.unitPriceVnd * request.quantity,
    };
  } else {
    const quantity = Math.ceil(request.durationMinutes / request.billingIntervalMinutes);
    snapshot = {
      kind: request.kind,
      name: request.name,
      unitName: `${request.billingIntervalMinutes} phút`,
      unitPriceVnd: request.pricePerIntervalVnd,
      quantity,
      durationMinutes: request.durationMinutes,
      billingIntervalMinutes: request.billingIntervalMinutes,
      lineTotalVnd: request.pricePerIntervalVnd * quantity,
    };
  }

  if (
    !Number.isSafeInteger(snapshot.lineTotalVnd) ||
    snapshot.lineTotalVnd < 0 ||
    snapshot.lineTotalVnd > maximumMoneyVnd
  ) {
    throw new AdminCustomChargeDomainError(
      'CUSTOM_CHARGE_TOTAL_TOO_LARGE',
      'Tổng tiền khoản phát sinh vượt giới hạn hệ thống.',
    );
  }

  return snapshot;
}

function isSameSnapshot(row: ExistingChargeRow, snapshot: ChargeSnapshot): boolean {
  return (
    row.line_kind === snapshot.kind &&
    row.item_name_snapshot === snapshot.name &&
    row.unit_name_snapshot === snapshot.unitName &&
    row.unit_price_snapshot_vnd === snapshot.unitPriceVnd &&
    row.quantity === snapshot.quantity &&
    row.duration_minutes === snapshot.durationMinutes &&
    row.billing_interval_minutes === snapshot.billingIntervalMinutes
  );
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

async function acquireBillLock(client: PoolClient, billId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`bill:${billId}`]);
}

async function requireBillIdForCharge(client: PoolClient, chargeId: string): Promise<string> {
  const result = await client.query<{ bill_id: string } & QueryResultRow>(
    `SELECT bill_id FROM order_lines WHERE id = $1 LIMIT 1`,
    [chargeId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new AdminCustomChargeDomainError(
      'ADMIN_CUSTOM_CHARGE_NOT_FOUND',
      'Không tìm thấy khoản phát sinh.',
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
    throw new AdminCustomChargeDomainError(
      'CUSTOM_CHARGE_TOTAL_TOO_LARGE',
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
    throw new AdminCustomChargeDomainError(
      'CUSTOM_CHARGE_TOTAL_TOO_LARGE',
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
    chargeId: string;
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
      VALUES ($1, 'ADMIN', $2, $3, 'order_line', $4, $5::jsonb)
    `,
    [
      input.venueId,
      input.adminUserId,
      input.action,
      input.chargeId,
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
    // Realtime delivery is advisory after the transaction commits.
  }
}

async function readBack(
  readBill: AdminBillReader,
  billId: string,
): Promise<AdminBillDetailResponse> {
  const detail = await readBill(billId);
  if (!detail) throw new Error('Updated bill could not be read back.');
  return detail;
}

export function createAdminCustomChargeService(
  pool: Pool,
  readBill: AdminBillReader,
  eventPublisher?: OrderCreatedEventPublisher,
): AdminCustomChargeService {
  return {
    async create(command) {
      const snapshot = toSnapshot(command.request);
      const idempotencyKey = `admin:custom:${command.request.idempotencyKey}`;

      const result = await withTransaction(pool, async (client): Promise<MutationResult> => {
        await acquireBillLock(client, command.billId);

        const billResult = await client.query<BillRow>(
          `SELECT id, venue_id, service_point_id, status FROM bills WHERE id = $1 FOR UPDATE`,
          [command.billId],
        );
        const bill = billResult.rows[0];

        if (!bill) {
          throw new AdminCustomChargeDomainError('ADMIN_BILL_NOT_FOUND', 'Không tìm thấy bill.');
        }
        if (bill.status !== 'OPEN') {
          throw new AdminCustomChargeDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để thêm khoản phát sinh.',
          );
        }

        const existingResult = await client.query<ExistingChargeRow>(
          `
            SELECT
              orders.id AS order_id,
              order_lines.id AS line_id,
              orders.bill_id,
              order_lines.line_kind,
              order_lines.item_name_snapshot,
              order_lines.unit_name_snapshot,
              order_lines.unit_price_snapshot_vnd,
              order_lines.quantity,
              order_lines.duration_minutes,
              order_lines.billing_interval_minutes
            FROM orders
            INNER JOIN order_lines ON order_lines.order_id = orders.id
            WHERE orders.idempotency_key = $1
            LIMIT 1
          `,
          [idempotencyKey],
        );
        const existing = existingResult.rows[0];

        if (existing) {
          if (existing.bill_id !== bill.id || !isSameSnapshot(existing, snapshot)) {
            throw new AdminCustomChargeDomainError(
              'CUSTOM_CHARGE_IDEMPOTENCY_CONFLICT',
              'Idempotency key đã được dùng cho một khoản phát sinh khác.',
            );
          }

          return {
            billId: bill.id,
            servicePointId: bill.service_point_id,
            orderId: existing.order_id,
            publish: false,
          };
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
          [bill.venue_id, bill.service_point_id, bill.id, idempotencyKey, snapshot.lineTotalVnd],
        );
        const order = orderResult.rows[0];
        if (!order) throw new Error('PostgreSQL did not return the custom-charge order.');

        const lineResult = await client.query<{ id: string } & QueryResultRow>(
          `
            INSERT INTO order_lines (
              order_id,
              bill_id,
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
              status
            )
            VALUES ($1, $2, $3, NULL, $4, $5, NULL, $6, $7, $8, $9, $10, 'ACTIVE')
            RETURNING id
          `,
          [
            order.id,
            bill.id,
            snapshot.kind,
            snapshot.name,
            snapshot.unitName,
            snapshot.unitPriceVnd,
            snapshot.quantity,
            snapshot.durationMinutes,
            snapshot.billingIntervalMinutes,
            snapshot.lineTotalVnd,
          ],
        );
        const line = lineResult.rows[0];
        if (!line) throw new Error('PostgreSQL did not return the custom-charge line.');

        await recalculateOrderAndBill(client, order.id, bill.id);
        await writeActivity(client, {
          venueId: bill.venue_id,
          adminUserId: command.adminUserId,
          action: 'bill.custom_charge_added',
          chargeId: line.id,
          metadata: {
            billId: bill.id,
            orderId: order.id,
            servicePointId: bill.service_point_id,
            ...snapshot,
          },
        });

        return {
          billId: bill.id,
          servicePointId: bill.service_point_id,
          orderId: order.id,
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

    async update(command) {
      const snapshot = toSnapshot(command.request);
      const result = await withTransaction(pool, async (client): Promise<MutationResult> => {
        const billId = await requireBillIdForCharge(client, command.chargeId);
        await acquireBillLock(client, billId);

        const chargeResult = await client.query<LockedChargeRow>(
          `
            SELECT
              order_lines.id,
              order_lines.order_id,
              order_lines.bill_id,
              orders.venue_id,
              orders.service_point_id,
              order_lines.line_kind,
              order_lines.item_name_snapshot,
              order_lines.unit_name_snapshot,
              order_lines.unit_price_snapshot_vnd,
              order_lines.quantity,
              order_lines.duration_minutes,
              order_lines.billing_interval_minutes,
              order_lines.status AS line_status,
              orders.status AS order_status,
              bills.status AS bill_status
            FROM order_lines
            INNER JOIN orders ON orders.id = order_lines.order_id
            INNER JOIN bills ON bills.id = order_lines.bill_id
            WHERE order_lines.id = $1
            FOR UPDATE OF order_lines, orders, bills
          `,
          [command.chargeId],
        );
        const charge = chargeResult.rows[0];

        if (!charge || charge.line_kind === 'CATALOG') {
          throw new AdminCustomChargeDomainError(
            'ADMIN_CUSTOM_CHARGE_NOT_FOUND',
            'Không tìm thấy khoản phát sinh.',
          );
        }
        if (charge.bill_status !== 'OPEN') {
          throw new AdminCustomChargeDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để chỉnh sửa.',
          );
        }
        if (await hasActiveSettlementsForLine(client, charge.id)) {
          throw new AdminCustomChargeDomainError(
            'CUSTOM_CHARGE_HAS_ACTIVE_SETTLEMENTS',
            'Không thể sửa khoản phát sinh còn settlement đang hoạt động.',
          );
        }
        if (
          charge.line_status !== 'ACTIVE' ||
          !['PENDING', 'ACCEPTED'].includes(charge.order_status)
        ) {
          throw new AdminCustomChargeDomainError(
            'CUSTOM_CHARGE_NOT_EDITABLE',
            'Chỉ khoản phát sinh chưa phục vụ và đang hoạt động mới được chỉnh sửa.',
          );
        }
        if (charge.line_kind !== snapshot.kind) {
          throw new AdminCustomChargeDomainError(
            'CUSTOM_CHARGE_KIND_IMMUTABLE',
            'Không thể đổi loại khoản phát sinh sau khi tạo.',
          );
        }

        await client.query(
          `
            UPDATE order_lines
            SET item_name_snapshot = $2,
                unit_name_snapshot = $3,
                unit_price_snapshot_vnd = $4,
                quantity = $5,
                duration_minutes = $6,
                billing_interval_minutes = $7,
                line_total_vnd = $8,
                updated_at = now()
            WHERE id = $1
          `,
          [
            charge.id,
            snapshot.name,
            snapshot.unitName,
            snapshot.unitPriceVnd,
            snapshot.quantity,
            snapshot.durationMinutes,
            snapshot.billingIntervalMinutes,
            snapshot.lineTotalVnd,
          ],
        );

        await recalculateOrderAndBill(client, charge.order_id, charge.bill_id);
        await writeActivity(client, {
          venueId: charge.venue_id,
          adminUserId: command.adminUserId,
          action: 'bill.custom_charge_updated',
          chargeId: charge.id,
          metadata: {
            billId: charge.bill_id,
            orderId: charge.order_id,
            previous: {
              kind: charge.line_kind,
              name: charge.item_name_snapshot,
              unitName: charge.unit_name_snapshot,
              unitPriceVnd: charge.unit_price_snapshot_vnd,
              quantity: charge.quantity,
              durationMinutes: charge.duration_minutes,
              billingIntervalMinutes: charge.billing_interval_minutes,
            },
            next: snapshot,
          },
        });

        return {
          billId: charge.bill_id,
          servicePointId: charge.service_point_id,
          orderId: charge.order_id,
          publish: true,
        };
      });

      const detail = await readBack(readBill, result.billId);
      publishBestEffort(eventPublisher, {
        type: 'bill.updated',
        servicePointId: result.servicePointId,
        billId: result.billId,
        orderId: result.orderId,
      });
      return detail;
    },

    async void(command) {
      const result = await withTransaction(pool, async (client): Promise<MutationResult> => {
        const billId = await requireBillIdForCharge(client, command.chargeId);
        await acquireBillLock(client, billId);

        const chargeResult = await client.query<LockedChargeRow>(
          `
            SELECT
              order_lines.id,
              order_lines.order_id,
              order_lines.bill_id,
              orders.venue_id,
              orders.service_point_id,
              order_lines.line_kind,
              order_lines.item_name_snapshot,
              order_lines.unit_name_snapshot,
              order_lines.unit_price_snapshot_vnd,
              order_lines.quantity,
              order_lines.duration_minutes,
              order_lines.billing_interval_minutes,
              order_lines.status AS line_status,
              orders.status AS order_status,
              bills.status AS bill_status
            FROM order_lines
            INNER JOIN orders ON orders.id = order_lines.order_id
            INNER JOIN bills ON bills.id = order_lines.bill_id
            WHERE order_lines.id = $1
            FOR UPDATE OF order_lines, orders, bills
          `,
          [command.chargeId],
        );
        const charge = chargeResult.rows[0];

        if (!charge || charge.line_kind === 'CATALOG') {
          throw new AdminCustomChargeDomainError(
            'ADMIN_CUSTOM_CHARGE_NOT_FOUND',
            'Không tìm thấy khoản phát sinh.',
          );
        }
        if (charge.bill_status !== 'OPEN') {
          throw new AdminCustomChargeDomainError(
            'ADMIN_BILL_NOT_OPEN',
            'Bill không còn mở để chỉnh sửa.',
          );
        }
        if (await hasActiveSettlementsForLine(client, charge.id)) {
          throw new AdminCustomChargeDomainError(
            'CUSTOM_CHARGE_HAS_ACTIVE_SETTLEMENTS',
            'Không thể void khoản phát sinh còn settlement đang hoạt động.',
          );
        }
        if (charge.line_status === 'VOIDED') {
          throw new AdminCustomChargeDomainError(
            'CUSTOM_CHARGE_ALREADY_VOIDED',
            'Khoản phát sinh đã được void trước đó.',
          );
        }
        if (charge.order_status === 'CANCELLED') {
          throw new AdminCustomChargeDomainError(
            'CUSTOM_CHARGE_NOT_EDITABLE',
            'Không thể void khoản phát sinh của order đã hủy.',
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
          [charge.id, command.request.reason],
        );

        await recalculateOrderAndBill(client, charge.order_id, charge.bill_id);
        await writeActivity(client, {
          venueId: charge.venue_id,
          adminUserId: command.adminUserId,
          action: 'bill.custom_charge_voided',
          chargeId: charge.id,
          metadata: {
            billId: charge.bill_id,
            orderId: charge.order_id,
            kind: charge.line_kind,
            reason: command.request.reason,
          },
        });

        return {
          billId: charge.bill_id,
          servicePointId: charge.service_point_id,
          orderId: charge.order_id,
          publish: true,
        };
      });

      const detail = await readBack(readBill, result.billId);
      publishBestEffort(eventPublisher, {
        type: 'bill.updated',
        servicePointId: result.servicePointId,
        billId: result.billId,
        orderId: result.orderId,
      });
      return detail;
    },
  };
}
