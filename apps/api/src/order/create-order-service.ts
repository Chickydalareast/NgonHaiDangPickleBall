import {
  createOrderResponseSchema,
  type CreateOrderRequest,
  type CreateOrderResponse,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';

export type CreateOrderErrorCode =
  | 'SERVICE_POINT_NOT_FOUND'
  | 'CATALOG_ITEM_UNAVAILABLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'BILL_NOT_OPEN'
  | 'ORDER_TOTAL_TOO_LARGE';

export class CreateOrderDomainError extends Error {
  constructor(
    readonly code: CreateOrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CreateOrderDomainError';
  }
}

export interface CreateOrderCommand {
  servicePointSlug: string;
  request: CreateOrderRequest;
}

export interface CreateOrderService {
  create(command: CreateOrderCommand): Promise<CreateOrderResponse>;
}

interface ServicePointRow extends QueryResultRow {
  id: string;
  venue_id: string;
}

interface CatalogItemRow extends QueryResultRow {
  id: string;
  name: string;
  unit_name: string;
  price_vnd: number;
  image_public_id: string | null;
}

interface OrderWithBillRow extends QueryResultRow {
  order_id: string;
  service_point_id: string;
  bill_id: string;
  order_status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  note: string | null;
  order_total_vnd: number;
  order_created_at: Date;
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  bill_subtotal_vnd: number;
  bill_total_vnd: number;
}

interface OrderLineRow extends QueryResultRow {
  id: string;
  catalog_item_id: string;
  item_name_snapshot: string;
  unit_name_snapshot: string;
  image_public_id_snapshot: string | null;
  unit_price_snapshot_vnd: number;
  quantity: number;
  line_total_vnd: number;
  status: 'ACTIVE' | 'VOIDED';
}

interface BillRow extends QueryResultRow {
  id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  subtotal_vnd: number;
  total_vnd: number;
}

interface CreatedOrderRow extends QueryResultRow {
  id: string;
  status: 'PENDING';
  note: string | null;
  total_vnd: number;
  created_at: Date;
}

const maximumMoneyVnd = 2_147_483_647;

async function acquireTransactionLock(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

async function findActiveServicePoint(
  client: PoolClient,
  slug: string,
): Promise<ServicePointRow | null> {
  const result = await client.query<ServicePointRow>(
    `
      SELECT service_points.id, service_points.venue_id
      FROM service_points
      INNER JOIN venues ON venues.id = service_points.venue_id
      WHERE service_points.slug = $1
        AND service_points.status = 'ACTIVE'
        AND venues.status = 'ACTIVE'
      LIMIT 1
    `,
    [slug],
  );

  return result.rows[0] ?? null;
}

async function readOrderResponse(
  client: PoolClient,
  idempotencyKey: string,
  expectedServicePointId: string,
  replayed: boolean,
): Promise<CreateOrderResponse | null> {
  const orderResult = await client.query<OrderWithBillRow>(
    `
      SELECT
        orders.id AS order_id,
        orders.service_point_id,
        orders.bill_id,
        orders.status AS order_status,
        orders.note,
        orders.total_vnd AS order_total_vnd,
        orders.created_at AS order_created_at,
        bills.status AS bill_status,
        bills.subtotal_vnd AS bill_subtotal_vnd,
        bills.total_vnd AS bill_total_vnd
      FROM orders
      INNER JOIN bills ON bills.id = orders.bill_id
      WHERE orders.idempotency_key = $1
      LIMIT 1
    `,
    [idempotencyKey],
  );

  const order = orderResult.rows[0];

  if (!order) {
    return null;
  }

  if (order.service_point_id !== expectedServicePointId) {
    throw new CreateOrderDomainError(
      'IDEMPOTENCY_KEY_REUSED',
      'Mã gửi order đã được sử dụng cho một sân khác.',
    );
  }

  const lineResult = await client.query<OrderLineRow>(
    `
      SELECT
        id,
        catalog_item_id,
        item_name_snapshot,
        unit_name_snapshot,
        image_public_id_snapshot,
        unit_price_snapshot_vnd,
        quantity,
        line_total_vnd,
        status
      FROM order_lines
      WHERE order_id = $1
      ORDER BY created_at, id
    `,
    [order.order_id],
  );

  return createOrderResponseSchema.parse({
    replayed,
    order: {
      id: order.order_id,
      status: order.order_status,
      note: order.note,
      totalVnd: order.order_total_vnd,
      createdAt: order.order_created_at.toISOString(),
    },
    bill: {
      id: order.bill_id,
      status: order.bill_status,
      subtotalVnd: order.bill_subtotal_vnd,
      totalVnd: order.bill_total_vnd,
    },
    lines: lineResult.rows.map((line) => ({
      id: line.id,
      catalogItemId: line.catalog_item_id,
      itemName: line.item_name_snapshot,
      unitName: line.unit_name_snapshot,
      imagePublicId: line.image_public_id_snapshot,
      unitPriceVnd: line.unit_price_snapshot_vnd,
      quantity: line.quantity,
      lineTotalVnd: line.line_total_vnd,
      status: line.status,
    })),
  });
}

async function findOrCreateOpenBill(
  client: PoolClient,
  servicePoint: ServicePointRow,
): Promise<BillRow> {
  const existing = await client.query<BillRow>(
    `
      SELECT id, status, subtotal_vnd, total_vnd
      FROM bills
      WHERE service_point_id = $1 AND status = 'OPEN'
      LIMIT 1
      FOR UPDATE
    `,
    [servicePoint.id],
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await client.query<BillRow>(
    `
      INSERT INTO bills (venue_id, service_point_id, status)
      VALUES ($1, $2, 'OPEN')
      RETURNING id, status, subtotal_vnd, total_vnd
    `,
    [servicePoint.venue_id, servicePoint.id],
  );

  const bill = created.rows[0];

  if (!bill) {
    throw new Error('PostgreSQL did not return the created bill.');
  }

  return bill;
}

function normalizeNote(note: string | null | undefined): string | null {
  const normalized = note?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

export function createOrderService(pool: Pool): CreateOrderService {
  return {
    async create(command): Promise<CreateOrderResponse> {
      return withTransaction(pool, async (client) => {
        await acquireTransactionLock(client, `order-idempotency:${command.request.idempotencyKey}`);

        const servicePoint = await findActiveServicePoint(client, command.servicePointSlug);

        if (!servicePoint) {
          throw new CreateOrderDomainError(
            'SERVICE_POINT_NOT_FOUND',
            'Không tìm thấy sân hoặc sân hiện không hoạt động.',
          );
        }

        const existing = await readOrderResponse(
          client,
          command.request.idempotencyKey,
          servicePoint.id,
          true,
        );

        if (existing) {
          return existing;
        }

        await acquireTransactionLock(client, `open-bill:${servicePoint.id}`);

        const requestedItemIds = command.request.items.map((item) => item.catalogItemId);
        const itemResult = await client.query<CatalogItemRow>(
          `
            SELECT id, name, unit_name, price_vnd, image_public_id
            FROM catalog_items
            WHERE id = ANY($1::uuid[])
              AND venue_id = $2
              AND status = 'ACTIVE'
              AND is_available = TRUE
          `,
          [requestedItemIds, servicePoint.venue_id],
        );
        const itemById = new Map(itemResult.rows.map((item) => [item.id, item] as const));

        if (itemById.size !== requestedItemIds.length) {
          throw new CreateOrderDomainError(
            'CATALOG_ITEM_UNAVAILABLE',
            'Một hoặc nhiều món không còn khả dụng. Vui lòng tải lại menu.',
          );
        }

        const calculatedLines = command.request.items.map((requestLine) => {
          const catalogItem = itemById.get(requestLine.catalogItemId);

          if (!catalogItem) {
            throw new CreateOrderDomainError(
              'CATALOG_ITEM_UNAVAILABLE',
              'Một hoặc nhiều món không còn khả dụng. Vui lòng tải lại menu.',
            );
          }

          const lineTotalVnd = catalogItem.price_vnd * requestLine.quantity;

          if (!Number.isSafeInteger(lineTotalVnd) || lineTotalVnd > maximumMoneyVnd) {
            throw new CreateOrderDomainError(
              'ORDER_TOTAL_TOO_LARGE',
              'Giá trị order vượt giới hạn hệ thống.',
            );
          }

          return {
            catalogItem,
            quantity: requestLine.quantity,
            lineTotalVnd,
          };
        });
        const orderTotalVnd = calculatedLines.reduce((total, line) => total + line.lineTotalVnd, 0);

        if (!Number.isSafeInteger(orderTotalVnd) || orderTotalVnd > maximumMoneyVnd) {
          throw new CreateOrderDomainError(
            'ORDER_TOTAL_TOO_LARGE',
            'Giá trị order vượt giới hạn hệ thống.',
          );
        }

        const bill = await findOrCreateOpenBill(client, servicePoint);

        if (bill.total_vnd + orderTotalVnd > maximumMoneyVnd) {
          throw new CreateOrderDomainError(
            'ORDER_TOTAL_TOO_LARGE',
            'Tổng bill vượt giới hạn hệ thống.',
          );
        }

        const note = normalizeNote(command.request.note);
        const createdOrderResult = await client.query<CreatedOrderRow>(
          `
            INSERT INTO orders (
              venue_id,
              service_point_id,
              bill_id,
              idempotency_key,
              status,
              note,
              total_vnd
            )
            VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
            RETURNING id, status, note, total_vnd, created_at
          `,
          [
            servicePoint.venue_id,
            servicePoint.id,
            bill.id,
            command.request.idempotencyKey,
            note,
            orderTotalVnd,
          ],
        );
        const createdOrder = createdOrderResult.rows[0];

        if (!createdOrder) {
          throw new Error('PostgreSQL did not return the created order.');
        }

        for (const line of calculatedLines) {
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
              createdOrder.id,
              bill.id,
              line.catalogItem.id,
              line.catalogItem.name,
              line.catalogItem.unit_name,
              line.catalogItem.image_public_id,
              line.catalogItem.price_vnd,
              line.quantity,
              line.lineTotalVnd,
            ],
          );
        }

        const updatedBillResult = await client.query<BillRow>(
          `
            WITH totals AS (
              SELECT COALESCE(SUM(line_total_vnd), 0)::integer AS total_vnd
              FROM order_lines
              WHERE bill_id = $1 AND status = 'ACTIVE'
            )
            UPDATE bills
            SET
              subtotal_vnd = totals.total_vnd,
              total_vnd = totals.total_vnd,
              updated_at = now()
            FROM totals
            WHERE bills.id = $1 AND bills.status = 'OPEN'
            RETURNING bills.id, bills.status, bills.subtotal_vnd, bills.total_vnd
          `,
          [bill.id],
        );

        if (!updatedBillResult.rows[0]) {
          throw new CreateOrderDomainError(
            'BILL_NOT_OPEN',
            'Bill của sân không còn mở. Vui lòng gửi lại order.',
          );
        }

        await client.query(
          `
            INSERT INTO activity_logs (
              venue_id,
              actor_type,
              action,
              entity_type,
              entity_id,
              metadata
            )
            VALUES ($1, 'CUSTOMER', 'order.created', 'order', $2, $3::jsonb)
          `,
          [
            servicePoint.venue_id,
            createdOrder.id,
            JSON.stringify({
              billId: bill.id,
              servicePointId: servicePoint.id,
              totalVnd: orderTotalVnd,
            }),
          ],
        );

        const response = await readOrderResponse(
          client,
          command.request.idempotencyKey,
          servicePoint.id,
          false,
        );

        if (!response) {
          throw new Error('Created order could not be read back.');
        }

        return response;
      });
    },
  };
}
