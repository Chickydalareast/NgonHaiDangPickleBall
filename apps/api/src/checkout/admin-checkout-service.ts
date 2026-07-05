import {
  adminCheckoutPreviewResponseSchema,
  createCourtRentalResponseSchema,
  createPaymentBatchResponseSchema,
  type AdminBillDetailResponse,
  type AdminCheckoutPreviewResponse,
  type CheckoutItem,
  type CreateCourtRentalRequest,
  type OpenAdminBillResponse,
  type CreateCourtRentalResponse,
  type CreatePaymentBatchRequest,
  type CreatePaymentBatchResponse,
  type CourtRentalCharge,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';
import { calculateCourtRentalPrice } from './court-rental-pricing.js';

const maximumMoneyVnd = 2_147_483_647;

export type AdminCheckoutErrorCode =
  | 'ADMIN_SERVICE_POINT_NOT_FOUND'
  | 'ADMIN_SERVICE_POINT_INACTIVE'
  | 'ADMIN_BILL_NOT_FOUND'
  | 'ADMIN_BILL_NOT_OPEN'
  | 'COURT_RENTAL_ALREADY_EXISTS'
  | 'COURT_RENTAL_TOTAL_TOO_LARGE'
  | 'PAYMENT_ALLOCATION_INVALID'
  | 'PAYMENT_BATCH_IDEMPOTENCY_CONFLICT'
  | 'PAYMENT_TOTAL_TOO_LARGE';

export class AdminCheckoutDomainError extends Error {
  constructor(
    readonly code: AdminCheckoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminCheckoutDomainError';
  }
}

export interface AdminCheckoutService {
  openBill(command: {
    adminUserId: string;
    servicePointId: string;
  }): Promise<OpenAdminBillResponse>;
  readPreview(billId: string): Promise<AdminCheckoutPreviewResponse>;
  createCourtRental(command: {
    adminUserId: string;
    billId: string;
    request: CreateCourtRentalRequest;
  }): Promise<CreateCourtRentalResponse>;
  createPaymentBatch(command: {
    adminUserId: string;
    billId: string;
    request: CreatePaymentBatchRequest;
  }): Promise<CreatePaymentBatchResponse>;
}

export type AdminBillReader = (billId: string) => Promise<AdminBillDetailResponse | null>;

interface BillRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  service_point_code: string;
  service_point_name: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  updated_at: Date;
}

interface ExistingRentalRow extends QueryResultRow {
  id: string;
  order_line_id: string;
  idempotency_key: string;
  start_time: string;
  duration_hours: number;
  base_amount_vnd: number;
  surcharge_amount_vnd: number;
  total_amount_vnd: number;
  breakdown: unknown;
  line_status: 'ACTIVE' | 'VOIDED';
}

interface AllocationLineRow extends QueryResultRow {
  id: string;
  bill_id: string;
  order_id: string;
  item_name_snapshot: string;
  unit_name_snapshot: string;
  unit_price_snapshot_vnd: number;
  quantity: number;
  line_kind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  line_status: 'ACTIVE' | 'VOIDED';
  order_status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  allocated_quantity: number;
}

interface PreviewLineRow extends QueryResultRow {
  id: string;
  line_kind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  item_name_snapshot: string;
  unit_name_snapshot: string;
  unit_price_snapshot_vnd: number;
  quantity: number;
  paid_quantity: number;
  waived_quantity: number;
}

interface PaymentRow extends QueryResultRow {
  batch_id: string;
  batch_created_at: Date;
  line_id: string;
  line_kind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  item_name_snapshot: string;
  unit_name_snapshot: string;
  unit_price_snapshot_vnd: number;
  quantity: number;
  amount_vnd: number;
}

function buildCourtRentalPricing(
  servicePointCode: string,
  request: CreateCourtRentalRequest,
): Omit<CourtRentalCharge, 'id' | 'orderLineId' | 'status'> {
  const pricing = calculateCourtRentalPrice(servicePointCode, request);

  if (!Number.isSafeInteger(pricing.totalAmountVnd) || pricing.totalAmountVnd > maximumMoneyVnd) {
    throw new AdminCheckoutDomainError(
      'COURT_RENTAL_TOTAL_TOO_LARGE',
      'Tổng phí thuê sân vượt giới hạn hệ thống.',
    );
  }

  return pricing;
}

async function acquireBillLock(client: PoolClient, billId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`bill:${billId}`]);
}

async function requireOpenBill(client: PoolClient, billId: string, lock = false): Promise<BillRow> {
  const result = await client.query<BillRow>(
    `
      SELECT
        bills.id,
        bills.venue_id,
        bills.service_point_id,
        bills.status,
        bills.updated_at,
        service_points.code AS service_point_code,
        service_points.name AS service_point_name
      FROM bills
      INNER JOIN service_points ON service_points.id = bills.service_point_id
      WHERE bills.id = $1
      ${lock ? 'FOR UPDATE OF bills' : ''}
    `,
    [billId],
  );
  const bill = result.rows[0];
  if (!bill) throw new AdminCheckoutDomainError('ADMIN_BILL_NOT_FOUND', 'Không tìm thấy bill.');
  if (bill.status !== 'OPEN') {
    throw new AdminCheckoutDomainError('ADMIN_BILL_NOT_OPEN', 'Bill không còn mở.');
  }
  return bill;
}

function groupItems(
  lines: {
    id: string;
    lineKind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
    itemName: string;
    unitName: string;
    unitPriceVnd: number;
    quantity: number;
  }[],
): CheckoutItem[] {
  const groups = new Map<string, CheckoutItem>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const key = `${line.lineKind}|${line.itemName}|${line.unitName}|${line.unitPriceVnd}`;
    const current = groups.get(key);
    if (current) {
      current.quantity += line.quantity;
      current.totalVnd += line.quantity * line.unitPriceVnd;
      current.sourceLineIds.push(line.id);
    } else {
      groups.set(key, {
        lineKind: line.lineKind,
        itemName: line.itemName,
        unitName: line.unitName,
        unitPriceVnd: line.unitPriceVnd,
        quantity: line.quantity,
        totalVnd: line.quantity * line.unitPriceVnd,
        sourceLineIds: [line.id],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.itemName.localeCompare(b.itemName, 'vi'));
}

async function readCourtRentals(client: PoolClient, billId: string): Promise<CourtRentalCharge[]> {
  const result = await client.query<ExistingRentalRow>(
    `
      SELECT
        court_rental_charges.id,
        court_rental_charges.order_line_id,
        court_rental_charges.idempotency_key,
        court_rental_charges.start_time,
        court_rental_charges.duration_hours,
        court_rental_charges.base_amount_vnd,
        court_rental_charges.surcharge_amount_vnd,
        court_rental_charges.total_amount_vnd,
        court_rental_charges.breakdown,
        order_lines.status AS line_status
      FROM court_rental_charges
      INNER JOIN order_lines ON order_lines.id = court_rental_charges.order_line_id
      WHERE court_rental_charges.bill_id = $1
      ORDER BY court_rental_charges.created_at
    `,
    [billId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    orderLineId: row.order_line_id,
    startTime: row.start_time,
    durationHours: row.duration_hours,
    baseAmountVnd: row.base_amount_vnd,
    surchargeAmountVnd: row.surcharge_amount_vnd,
    totalAmountVnd: row.total_amount_vnd,
    breakdown: row.breakdown as CourtRentalCharge['breakdown'],
    status: row.line_status,
  }));
}

export function createAdminCheckoutService(
  pool: Pool,
  readBill: AdminBillReader,
  eventPublisher?: OrderCreatedEventPublisher,
): AdminCheckoutService {
  return {
    async openBill(command) {
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `open-bill:${command.servicePointId}`,
        ]);
        const servicePointResult = await client.query<
          { id: string; venue_id: string; status: 'ACTIVE' | 'INACTIVE' } & QueryResultRow
        >(`SELECT id, venue_id, status FROM service_points WHERE id = $1 FOR UPDATE`, [
          command.servicePointId,
        ]);
        const servicePoint = servicePointResult.rows[0];
        if (!servicePoint) {
          throw new AdminCheckoutDomainError(
            'ADMIN_SERVICE_POINT_NOT_FOUND',
            'Không tìm thấy sân.',
          );
        }
        if (servicePoint.status !== 'ACTIVE') {
          throw new AdminCheckoutDomainError(
            'ADMIN_SERVICE_POINT_INACTIVE',
            'Sân đang tắt nên không thể mở bill.',
          );
        }
        const existing = await client.query<{ id: string } & QueryResultRow>(
          `SELECT id FROM bills WHERE service_point_id = $1 AND status = 'OPEN' LIMIT 1`,
          [servicePoint.id],
        );
        if (existing.rows[0]) return { billId: existing.rows[0].id, created: false };

        const inserted = await client.query<{ id: string } & QueryResultRow>(
          `INSERT INTO bills (venue_id, service_point_id, status, subtotal_vnd, total_vnd)
           VALUES ($1, $2, 'OPEN', 0, 0) RETURNING id`,
          [servicePoint.venue_id, servicePoint.id],
        );
        const billId = inserted.rows[0]?.id;
        if (!billId) throw new Error('PostgreSQL did not return the opened bill.');
        await client.query(
          `INSERT INTO activity_logs (venue_id, actor_type, actor_admin_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'ADMIN', $2, 'bill.opened_manually', 'bill', $3, $4::jsonb)`,
          [
            servicePoint.venue_id,
            command.adminUserId,
            billId,
            JSON.stringify({ servicePointId: servicePoint.id }),
          ],
        );
        return { billId, created: true };
      });
      const detail = await readBill(result.billId);
      if (!detail) throw new Error('Opened bill could not be read back.');
      if (result.created) {
        eventPublisher?.publish({
          type: 'bill.updated',
          servicePointId: command.servicePointId,
          billId: result.billId,
        });
      }
      return detail;
    },

    async readPreview(billId) {
      return withTransaction(
        pool,
        async (client) => {
          const bill = await requireOpenBill(client, billId);
          const lineResult = await client.query<PreviewLineRow>(
            `
              SELECT
                order_lines.id,
                order_lines.line_kind,
                order_lines.item_name_snapshot,
                order_lines.unit_name_snapshot,
                order_lines.unit_price_snapshot_vnd,
                order_lines.quantity,
                COALESCE(SUM(order_line_settlements.quantity) FILTER (
                  WHERE order_line_settlements.status = 'ACTIVE'
                    AND order_line_settlements.settlement_type = 'PAID'
                ), 0)::integer AS paid_quantity,
                COALESCE(SUM(order_line_settlements.quantity) FILTER (
                  WHERE order_line_settlements.status = 'ACTIVE'
                    AND order_line_settlements.settlement_type = 'WAIVED'
                ), 0)::integer AS waived_quantity
              FROM order_lines
              LEFT JOIN order_line_settlements ON order_line_settlements.order_line_id = order_lines.id
              WHERE order_lines.bill_id = $1 AND order_lines.status = 'ACTIVE'
              GROUP BY order_lines.id
              ORDER BY order_lines.created_at
            `,
            [billId],
          );
          const unresolvedResult = await client.query<{ count: string } & QueryResultRow>(
            `SELECT COUNT(*)::text AS count FROM orders WHERE bill_id = $1 AND status IN ('PENDING', 'ACCEPTED')`,
            [billId],
          );
          const paymentResult = await client.query<PaymentRow>(
            `
              SELECT
                COALESCE(payment_batches.id, order_line_settlements.id) AS batch_id,
                COALESCE(payment_batches.created_at, order_line_settlements.created_at) AS batch_created_at,
                order_lines.id AS line_id,
                order_lines.line_kind,
                order_lines.item_name_snapshot,
                order_lines.unit_name_snapshot,
                order_line_settlements.unit_price_snapshot_vnd,
                order_line_settlements.quantity,
                order_line_settlements.amount_vnd
              FROM order_line_settlements
              LEFT JOIN payment_batches
                ON payment_batches.id = order_line_settlements.payment_batch_id
              INNER JOIN order_lines ON order_lines.id = order_line_settlements.order_line_id
              WHERE order_line_settlements.bill_id = $1
                AND order_line_settlements.status = 'ACTIVE'
                AND order_line_settlements.settlement_type = 'PAID'
              ORDER BY COALESCE(payment_batches.created_at, order_line_settlements.created_at), order_line_settlements.created_at
            `,
            [billId],
          );
          const courtRentals = await readCourtRentals(client, billId);

          const allLines = lineResult.rows.map((row) => ({
            id: row.id,
            lineKind: row.line_kind,
            itemName: row.item_name_snapshot,
            unitName: row.unit_name_snapshot,
            unitPriceVnd: row.unit_price_snapshot_vnd,
            quantity: row.quantity,
          }));
          const outstandingLines = lineResult.rows.map((row) => ({
            id: row.id,
            lineKind: row.line_kind,
            itemName: row.item_name_snapshot,
            unitName: row.unit_name_snapshot,
            unitPriceVnd: row.unit_price_snapshot_vnd,
            quantity: row.quantity - row.paid_quantity - row.waived_quantity,
          }));
          const waivedLines = lineResult.rows.map((row) => ({
            id: row.id,
            lineKind: row.line_kind,
            itemName: row.item_name_snapshot,
            unitName: row.unit_name_snapshot,
            unitPriceVnd: row.unit_price_snapshot_vnd,
            quantity: row.waived_quantity,
          }));
          const batchMap = new Map<string, { id: string; createdAt: string; rows: PaymentRow[] }>();
          for (const row of paymentResult.rows) {
            const current = batchMap.get(row.batch_id);
            if (current) current.rows.push(row);
            else
              batchMap.set(row.batch_id, {
                id: row.batch_id,
                createdAt: row.batch_created_at.toISOString(),
                rows: [row],
              });
          }
          const paymentBatches = [...batchMap.values()].map((batch) => {
            const items = groupItems(
              batch.rows.map((row) => ({
                id: row.line_id,
                lineKind: row.line_kind,
                itemName: row.item_name_snapshot,
                unitName: row.unit_name_snapshot,
                unitPriceVnd: row.unit_price_snapshot_vnd,
                quantity: row.quantity,
              })),
            );
            return {
              id: batch.id,
              createdAt: batch.createdAt,
              totalVnd: items.reduce((sum, item) => sum + item.totalVnd, 0),
              items,
            };
          });
          const grossTotalVnd = allLines.reduce(
            (sum, line) => sum + line.quantity * line.unitPriceVnd,
            0,
          );
          const paidTotalVnd = paymentBatches.reduce((sum, batch) => sum + batch.totalVnd, 0);
          const waivedTotalVnd = waivedLines.reduce(
            (sum, line) => sum + line.quantity * line.unitPriceVnd,
            0,
          );
          const outstandingTotalVnd = outstandingLines.reduce(
            (sum, line) => sum + Math.max(0, line.quantity) * line.unitPriceVnd,
            0,
          );

          return adminCheckoutPreviewResponseSchema.parse({
            billId,
            revision: bill.updated_at.toISOString(),
            generatedAt: new Date().toISOString(),
            servicePoint: {
              id: bill.service_point_id,
              code: bill.service_point_code,
              name: bill.service_point_name,
            },
            unresolvedOrderCount: Number(unresolvedResult.rows[0]?.count ?? 0),
            grossTotalVnd,
            paidTotalVnd,
            waivedTotalVnd,
            outstandingTotalVnd,
            outstandingItems: groupItems(outstandingLines),
            waivedItems: groupItems(waivedLines),
            paymentBatches,
            allItems: groupItems(allLines),
            courtRentals,
          });
        },
        { isolationLevel: 'repeatable read', readOnly: true },
      );
    },

    async createCourtRental(command) {
      const result = await withTransaction(pool, async (client) => {
        await acquireBillLock(client, command.billId);
        const bill = await requireOpenBill(client, command.billId, true);
        const existing = await client.query<ExistingRentalRow>(
          `
            SELECT court_rental_charges.*, order_lines.status AS line_status
            FROM court_rental_charges
            INNER JOIN order_lines ON order_lines.id = court_rental_charges.order_line_id
            WHERE court_rental_charges.bill_id = $1 OR court_rental_charges.idempotency_key = $2
            ORDER BY court_rental_charges.created_at
            LIMIT 1
          `,
          [bill.id, command.request.idempotencyKey],
        );
        const existingRental = existing.rows[0];
        if (existingRental) {
          if (
            existingRental.idempotency_key === command.request.idempotencyKey &&
            existingRental.start_time === command.request.startTime &&
            existingRental.duration_hours === command.request.durationHours
          ) {
            return {
              billId: bill.id,
              servicePointId: bill.service_point_id,
              rentalId: existingRental.id,
              publish: false,
            };
          }
          throw new AdminCheckoutDomainError(
            'COURT_RENTAL_ALREADY_EXISTS',
            'Bill đã có phí thuê sân. Hãy void khoản cũ trước khi tạo lại.',
          );
        }

        const pricing = buildCourtRentalPricing(bill.service_point_code, command.request);
        const orderResult = await client.query<{ id: string } & QueryResultRow>(
          `
            INSERT INTO orders (
              venue_id, service_point_id, bill_id, idempotency_key, status, note,
              total_vnd, accepted_at, served_at
            )
            VALUES ($1, $2, $3, $4, 'SERVED', 'Phí thuê sân', $5, now(), now())
            RETURNING id
          `,
          [
            bill.venue_id,
            bill.service_point_id,
            bill.id,
            `admin:court-rental:${command.request.idempotencyKey}`,
            pricing.totalAmountVnd,
          ],
        );
        const orderId = orderResult.rows[0]?.id;
        if (!orderId) throw new Error('PostgreSQL did not return the court-rental order.');
        const lineResult = await client.query<{ id: string } & QueryResultRow>(
          `
            INSERT INTO order_lines (
              order_id, bill_id, line_kind, catalog_item_id, item_name_snapshot,
              unit_name_snapshot, image_public_id_snapshot, unit_price_snapshot_vnd,
              quantity, duration_minutes, billing_interval_minutes, line_total_vnd, status
            )
            VALUES ($1, $2, 'MANUAL_TIME', NULL, 'Phí thuê sân', 'lượt', NULL, $3, 1, $4, $4, $3, 'ACTIVE')
            RETURNING id
          `,
          [orderId, bill.id, pricing.totalAmountVnd, command.request.durationHours * 60],
        );
        const lineId = lineResult.rows[0]?.id;
        if (!lineId) throw new Error('PostgreSQL did not return the court-rental line.');
        const rentalResult = await client.query<{ id: string } & QueryResultRow>(
          `
            INSERT INTO court_rental_charges (
              bill_id, order_line_id, idempotency_key, start_time, duration_hours,
              base_amount_vnd, surcharge_amount_vnd, total_amount_vnd, breakdown,
              created_by_admin_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
            RETURNING id
          `,
          [
            bill.id,
            lineId,
            command.request.idempotencyKey,
            command.request.startTime,
            command.request.durationHours,
            pricing.baseAmountVnd,
            pricing.surchargeAmountVnd,
            pricing.totalAmountVnd,
            JSON.stringify(pricing.breakdown),
            command.adminUserId,
          ],
        );
        const rentalId = rentalResult.rows[0]?.id;
        if (!rentalId) throw new Error('PostgreSQL did not return the court rental.');
        await client.query(
          `UPDATE bills SET subtotal_vnd = subtotal_vnd + $2, total_vnd = total_vnd + $2, updated_at = now() WHERE id = $1`,
          [bill.id, pricing.totalAmountVnd],
        );
        await client.query(
          `INSERT INTO activity_logs (venue_id, actor_type, actor_admin_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'ADMIN', $2, 'bill.court_rental_added', 'order_line', $3, $4::jsonb)`,
          [
            bill.venue_id,
            command.adminUserId,
            lineId,
            JSON.stringify({ billId: bill.id, servicePointId: bill.service_point_id, ...pricing }),
          ],
        );
        return { billId: bill.id, servicePointId: bill.service_point_id, rentalId, publish: true };
      });
      const billDetail = await readBill(result.billId);
      if (!billDetail) throw new Error('Updated bill could not be read back.');
      const rentals = await withTransaction(
        pool,
        (client) => readCourtRentals(client, result.billId),
        { readOnly: true },
      );
      const rental = rentals.find((item) => item.id === result.rentalId);
      if (!rental) throw new Error('Created court rental could not be read back.');
      if (result.publish)
        eventPublisher?.publish({
          type: 'bill.updated',
          servicePointId: result.servicePointId,
          billId: result.billId,
        });
      return createCourtRentalResponseSchema.parse({ bill: billDetail, courtRental: rental });
    },

    async createPaymentBatch(command) {
      const result = await withTransaction(pool, async (client) => {
        await acquireBillLock(client, command.billId);
        const bill = await requireOpenBill(client, command.billId, true);
        const existingBatch = await client.query<
          { id: string; bill_id: string; total_vnd: number } & QueryResultRow
        >(`SELECT id, bill_id, total_vnd FROM payment_batches WHERE idempotency_key = $1 LIMIT 1`, [
          command.request.idempotencyKey,
        ]);
        if (existingBatch.rows[0]) {
          const batch = existingBatch.rows[0];
          if (batch.bill_id !== bill.id) {
            throw new AdminCheckoutDomainError(
              'PAYMENT_BATCH_IDEMPOTENCY_CONFLICT',
              'Idempotency key đã được dùng cho bill khác.',
            );
          }
          const allocationResult = await client.query<
            { order_line_id: string; quantity: number } & QueryResultRow
          >(
            `SELECT order_line_id, quantity FROM order_line_settlements WHERE payment_batch_id = $1 ORDER BY order_line_id`,
            [batch.id],
          );
          const expected = [...command.request.allocations].sort((a, b) =>
            a.lineId.localeCompare(b.lineId),
          );
          const sameAllocations =
            allocationResult.rows.length === expected.length &&
            allocationResult.rows.every(
              (row, index) =>
                row.order_line_id === expected[index]?.lineId &&
                row.quantity === expected[index]?.quantity,
            );
          if (!sameAllocations) {
            throw new AdminCheckoutDomainError(
              'PAYMENT_BATCH_IDEMPOTENCY_CONFLICT',
              'Idempotency key đã được dùng cho lần thanh toán khác.',
            );
          }
          return {
            batchId: batch.id,
            totalVnd: batch.total_vnd,
            servicePointId: bill.service_point_id,
            publish: false,
          };
        }

        const ids = command.request.allocations.map((item) => item.lineId);
        if (new Set(ids).size !== ids.length) {
          throw new AdminCheckoutDomainError(
            'PAYMENT_ALLOCATION_INVALID',
            'Mỗi line chỉ được xuất hiện một lần trong lần thanh toán.',
          );
        }
        const lineResult = await client.query<AllocationLineRow>(
          `
            SELECT
              order_lines.id, order_lines.bill_id, order_lines.order_id,
              order_lines.item_name_snapshot, order_lines.unit_name_snapshot,
              order_lines.unit_price_snapshot_vnd, order_lines.quantity,
              order_lines.line_kind, order_lines.status AS line_status,
              orders.status AS order_status,
              COALESCE(SUM(order_line_settlements.quantity) FILTER (WHERE order_line_settlements.status = 'ACTIVE'), 0)::integer AS allocated_quantity
            FROM order_lines
            INNER JOIN orders ON orders.id = order_lines.order_id
            LEFT JOIN order_line_settlements ON order_line_settlements.order_line_id = order_lines.id
            WHERE order_lines.id = ANY($1::uuid[])
            GROUP BY order_lines.id, orders.status
          `,
          [ids],
        );
        const lineMap = new Map(lineResult.rows.map((line) => [line.id, line]));
        let totalVnd = 0;
        for (const allocation of command.request.allocations) {
          const line = lineMap.get(allocation.lineId);
          if (!line) {
            throw new AdminCheckoutDomainError(
              'PAYMENT_ALLOCATION_INVALID',
              'Lần thanh toán chứa line hoặc số lượng không còn hợp lệ.',
            );
          }
          if (
            line.bill_id !== bill.id ||
            line.line_status !== 'ACTIVE' ||
            line.order_status === 'CANCELLED' ||
            allocation.quantity > line.quantity - line.allocated_quantity
          ) {
            throw new AdminCheckoutDomainError(
              'PAYMENT_ALLOCATION_INVALID',
              'Lần thanh toán chứa line hoặc số lượng không còn hợp lệ.',
            );
          }
          totalVnd += allocation.quantity * line.unit_price_snapshot_vnd;
        }
        if (!Number.isSafeInteger(totalVnd) || totalVnd > maximumMoneyVnd) {
          throw new AdminCheckoutDomainError(
            'PAYMENT_TOTAL_TOO_LARGE',
            'Tổng thanh toán vượt giới hạn hệ thống.',
          );
        }
        const batchResult = await client.query<{ id: string } & QueryResultRow>(
          `INSERT INTO payment_batches (bill_id, idempotency_key, total_vnd, created_by_admin_user_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [bill.id, command.request.idempotencyKey, totalVnd, command.adminUserId],
        );
        const batchId = batchResult.rows[0]?.id;
        if (!batchId) throw new Error('PostgreSQL did not return the payment batch.');
        for (const allocation of command.request.allocations) {
          const line = lineMap.get(allocation.lineId)!;
          await client.query(
            `
              INSERT INTO order_line_settlements (
                bill_id, order_line_id, payment_batch_id, settlement_type, quantity,
                unit_price_snapshot_vnd, amount_vnd, reason, idempotency_key,
                status, created_by_admin_user_id
              )
              VALUES ($1, $2, $3, 'PAID', $4, $5, $6, NULL, $7, 'ACTIVE', $8)
            `,
            [
              bill.id,
              line.id,
              batchId,
              allocation.quantity,
              line.unit_price_snapshot_vnd,
              allocation.quantity * line.unit_price_snapshot_vnd,
              `admin:payment-batch:${command.request.idempotencyKey}:${line.id}`,
              command.adminUserId,
            ],
          );
        }
        await client.query('UPDATE bills SET updated_at = now() WHERE id = $1', [bill.id]);
        await client.query(
          `INSERT INTO activity_logs (venue_id, actor_type, actor_admin_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'ADMIN', $2, 'bill.payment_batch_created', 'bill', $3, $4::jsonb)`,
          [
            bill.venue_id,
            command.adminUserId,
            bill.id,
            JSON.stringify({
              paymentBatchId: batchId,
              totalVnd,
              allocations: command.request.allocations,
            }),
          ],
        );
        return { batchId, totalVnd, servicePointId: bill.service_point_id, publish: true };
      });
      const billDetail = await readBill(command.billId);
      if (!billDetail) throw new Error('Updated bill could not be read back.');
      if (result.publish)
        eventPublisher?.publish({
          type: 'bill.updated',
          servicePointId: result.servicePointId,
          billId: command.billId,
        });
      return createPaymentBatchResponseSchema.parse({
        paymentBatchId: result.batchId,
        totalVnd: result.totalVnd,
        bill: billDetail,
      });
    },
  };
}
