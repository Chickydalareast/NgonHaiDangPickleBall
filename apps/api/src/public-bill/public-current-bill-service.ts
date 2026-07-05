import { publicCurrentBillResponseSchema, type PublicCurrentBillResponse } from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { buildBillProjection } from '../bill-projection/build-bill-projection.js';
import { buildLineSettlementStateMap } from '../bill-projection/settlement-state.js';
import { withTransaction } from '../db/transaction.js';

export type PublicCurrentBillErrorCode = 'SERVICE_POINT_NOT_FOUND';

export class PublicCurrentBillDomainError extends Error {
  constructor(
    readonly code: PublicCurrentBillErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PublicCurrentBillDomainError';
  }
}

export interface PublicCurrentBillService {
  read(servicePointSlug: string): Promise<PublicCurrentBillResponse>;
}

interface ServicePointRow extends QueryResultRow {
  venue_id: string;
  venue_name: string;
  venue_currency: 'VND';
  service_point_id: string;
  service_point_code: string;
  service_point_name: string;
  service_point_slug: string;
}

interface BillRow extends QueryResultRow {
  id: string;
  status: 'OPEN';
  opened_at: Date;
  updated_at: Date;
}

interface OrderRow extends QueryResultRow {
  id: string;
  idempotency_key: string;
  status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  total_vnd: number;
  accepted_at: Date | null;
  served_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}

interface LineRow extends QueryResultRow {
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
  created_at: Date;
}

interface SettlementRow extends QueryResultRow {
  id: string;
  order_line_id: string;
  settlement_type: 'PAID' | 'WAIVED';
  quantity: number;
  amount_vnd: number;
  status: 'ACTIVE' | 'REVERSED';
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

async function readSnapshot(
  client: PoolClient,
  servicePointSlug: string,
): Promise<PublicCurrentBillResponse> {
  const servicePointResult = await client.query<ServicePointRow>(
    `
      SELECT
        venues.id AS venue_id,
        venues.name AS venue_name,
        venues.currency AS venue_currency,
        service_points.id AS service_point_id,
        service_points.code AS service_point_code,
        service_points.name AS service_point_name,
        service_points.slug AS service_point_slug
      FROM service_points
      INNER JOIN venues ON venues.id = service_points.venue_id
      WHERE service_points.slug = $1
        AND service_points.status = 'ACTIVE'
        AND venues.status = 'ACTIVE'
      LIMIT 1
    `,
    [servicePointSlug],
  );
  const servicePoint = servicePointResult.rows[0];

  if (!servicePoint) {
    throw new PublicCurrentBillDomainError(
      'SERVICE_POINT_NOT_FOUND',
      'Không tìm thấy sân đang hoạt động.',
    );
  }

  const billResult = await client.query<BillRow>(
    `
      SELECT id, status, opened_at, updated_at
      FROM bills
      WHERE service_point_id = $1 AND status = 'OPEN'
      LIMIT 1
    `,
    [servicePoint.service_point_id],
  );
  const bill = billResult.rows[0];

  if (!bill) {
    return publicCurrentBillResponseSchema.parse({
      generatedAt: new Date().toISOString(),
      venue: {
        id: servicePoint.venue_id,
        name: servicePoint.venue_name,
        currency: servicePoint.venue_currency,
      },
      servicePoint: {
        id: servicePoint.service_point_id,
        code: servicePoint.service_point_code,
        name: servicePoint.service_point_name,
        slug: servicePoint.service_point_slug,
      },
      bill: null,
      summary: {
        grossTotalVnd: 0,
        paidTotalVnd: 0,
        waivedTotalVnd: 0,
        outstandingTotalVnd: 0,
        items: [],
      },
      orders: [],
    });
  }

  // A transaction-scoped PoolClient must not receive overlapping queries. Sequential
  // reads preserve one repeatable-read snapshot without pg deprecation warnings.
  const ordersResult = await client.query<OrderRow>(
    `
      SELECT
        id,
        idempotency_key,
        status,
        total_vnd,
        accepted_at,
        served_at,
        cancelled_at,
        created_at
      FROM orders
      WHERE bill_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [bill.id],
  );
  const linesResult = await client.query<LineRow>(
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
        created_at
      FROM order_lines
      WHERE bill_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [bill.id],
  );
  const settlementsResult = await client.query<SettlementRow>(
    `
      SELECT id, order_line_id, settlement_type, quantity, amount_vnd, status
      FROM order_line_settlements
      WHERE bill_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [bill.id],
  );

  const linesByOrder = new Map<string, LineRow[]>();
  for (const line of linesResult.rows) {
    const current = linesByOrder.get(line.order_id) ?? [];
    current.push(line);
    linesByOrder.set(line.order_id, current);
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

  return publicCurrentBillResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    venue: {
      id: servicePoint.venue_id,
      name: servicePoint.venue_name,
      currency: servicePoint.venue_currency,
    },
    servicePoint: {
      id: servicePoint.service_point_id,
      code: servicePoint.service_point_code,
      name: servicePoint.service_point_name,
      slug: servicePoint.service_point_slug,
    },
    bill: {
      id: bill.id,
      status: bill.status,
      openedAt: bill.opened_at.toISOString(),
      updatedAt: bill.updated_at.toISOString(),
    },
    summary,
    orders: ordersResult.rows.map((order) => ({
      id: order.id,
      source: order.idempotency_key.startsWith('admin:') ? 'ADMIN' : 'CUSTOMER',
      status: order.status,
      totalVnd: order.total_vnd,
      acceptedAt: toIso(order.accepted_at),
      servedAt: toIso(order.served_at),
      cancelledAt: toIso(order.cancelled_at),
      createdAt: order.created_at.toISOString(),
      lines: (linesByOrder.get(order.id) ?? []).map((line) => {
        const settlementState = settlementStateByLine.get(line.id);

        if (!settlementState) {
          throw new Error(`Settlement state missing for line ${line.id}.`);
        }

        return {
          id: line.id,
          catalogItemId: line.catalog_item_id,
          lineKind: line.line_kind,
          itemName: line.item_name_snapshot,
          unitName: line.unit_name_snapshot,
          imagePublicId: line.image_public_id_snapshot,
          unitPriceVnd: line.unit_price_snapshot_vnd,
          quantity: line.quantity,
          durationMinutes: line.duration_minutes,
          billingIntervalMinutes: line.billing_interval_minutes,
          lineTotalVnd: line.line_total_vnd,
          ...settlementState,
          status: line.status,
          createdAt: line.created_at.toISOString(),
        };
      }),
    })),
  });
}

export function createPublicCurrentBillService(pool: Pool): PublicCurrentBillService {
  return {
    read: (servicePointSlug) =>
      withTransaction(pool, (client) => readSnapshot(client, servicePointSlug), {
        isolationLevel: 'repeatable read',
        readOnly: true,
      }),
  };
}
