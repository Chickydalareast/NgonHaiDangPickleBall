import {
  acknowledgeAdminAlertResponseSchema,
  adminAlertsResponseSchema,
  adminRealtimeEventSchema,
  type AcknowledgeAdminAlertResponse,
  type AdminAlert,
  type AdminAlertsResponse,
  type AdminRealtimeEvent,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';

export type AdminAlertErrorCode = 'ADMIN_ALERT_NOT_FOUND' | 'ADMIN_ALERT_NOT_ACTIVE';

export class AdminAlertDomainError extends Error {
  constructor(
    readonly code: AdminAlertErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminAlertDomainError';
  }
}

export interface AdminAlertService {
  read(): Promise<AdminAlertsResponse>;
  acknowledgeOrder(command: {
    adminUserId: string;
    orderId: string;
  }): Promise<AcknowledgeAdminAlertResponse>;
  acknowledgeServiceRequest(command: {
    adminUserId: string;
    serviceRequestId: string;
  }): Promise<AcknowledgeAdminAlertResponse>;
}

interface OrderAlertRow extends QueryResultRow {
  order_id: string;
  bill_id: string;
  service_point_id: string;
  service_point_code: string;
  service_point_name: string;
  note: string | null;
  total_vnd: number;
  line_count: number;
  total_quantity: number;
  created_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by_admin_user_id: string | null;
}

interface ServiceRequestAlertRow extends QueryResultRow {
  service_request_id: string;
  bill_id: string | null;
  service_point_id: string;
  service_point_code: string;
  service_point_name: string;
  message: string | null;
  created_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by_admin_user_id: string | null;
}

interface OrderTargetRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  bill_id: string;
  status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
  idempotency_key: string;
  bill_status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
}

interface ServiceRequestTargetRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  status: 'PENDING' | 'RESOLVED' | 'CANCELLED';
}

interface AcknowledgementRow extends QueryResultRow {
  created_at: Date;
  actor_admin_user_id: string;
}

interface InsertedAcknowledgementRow extends QueryResultRow {
  created_at: Date;
  actor_admin_user_id: string;
}

function toAlertRank(alert: AdminAlert): number {
  const acknowledged = alert.acknowledgedAt !== null;

  if (alert.kind === 'SERVICE_REQUEST') {
    return acknowledged ? 2 : 0;
  }

  return acknowledged ? 3 : 1;
}

export function sortAdminAlerts(alerts: AdminAlert[]): AdminAlert[] {
  return [...alerts].sort((left, right) => {
    const rankDifference = toAlertRank(left) - toAlertRank(right);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);

    if (timeDifference !== 0) {
      return timeDifference;
    }

    const leftId = left.kind === 'ORDER' ? left.orderId : left.serviceRequestId;
    const rightId = right.kind === 'ORDER' ? right.orderId : right.serviceRequestId;
    return leftId.localeCompare(rightId);
  });
}

async function acquireTransactionLock(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

function publishBestEffort(
  publisher: OrderCreatedEventPublisher | undefined,
  event: AdminRealtimeEvent,
): void {
  if (!publisher) {
    return;
  }

  try {
    publisher.publish(event);
  } catch {
    // Realtime is advisory and must not roll back a committed acknowledgement.
  }
}

async function readExistingAcknowledgement(
  client: PoolClient,
  action: string,
  entityType: string,
  entityId: string,
): Promise<AcknowledgementRow | null> {
  const result = await client.query<AcknowledgementRow>(
    `
      SELECT created_at, actor_admin_user_id
      FROM activity_logs
      WHERE action = $1
        AND entity_type = $2
        AND entity_id = $3
        AND actor_type = 'ADMIN'
        AND actor_admin_user_id IS NOT NULL
      ORDER BY created_at, id
      LIMIT 1
    `,
    [action, entityType, entityId],
  );

  return result.rows[0] ?? null;
}

async function insertAcknowledgement(
  client: PoolClient,
  values: {
    venueId: string;
    servicePointId: string;
    billId?: string;
    adminUserId: string;
    action: string;
    entityType: string;
    entityId: string;
  },
): Promise<InsertedAcknowledgementRow> {
  const result = await client.query<InsertedAcknowledgementRow>(
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
      RETURNING created_at, actor_admin_user_id
    `,
    [
      values.venueId,
      values.adminUserId,
      values.action,
      values.entityType,
      values.entityId,
      JSON.stringify({
        servicePointId: values.servicePointId,
        ...(values.billId ? { billId: values.billId } : {}),
      }),
    ],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error('PostgreSQL did not return the alert acknowledgement.');
  }

  return row;
}

export function createAdminAlertService(
  pool: Pool,
  eventPublisher?: OrderCreatedEventPublisher,
): AdminAlertService {
  return {
    async read() {
      const [ordersResult, serviceRequestsResult] = await Promise.all([
        pool.query<OrderAlertRow>(`
          SELECT
            orders.id AS order_id,
            orders.bill_id,
            orders.service_point_id,
            service_points.code AS service_point_code,
            service_points.name AS service_point_name,
            orders.note,
            orders.total_vnd,
            COALESCE(lines.line_count, 0)::integer AS line_count,
            COALESCE(lines.total_quantity, 0)::integer AS total_quantity,
            orders.created_at,
            acknowledgement.created_at AS acknowledged_at,
            acknowledgement.actor_admin_user_id AS acknowledged_by_admin_user_id
          FROM orders
          INNER JOIN bills ON bills.id = orders.bill_id
          INNER JOIN service_points ON service_points.id = orders.service_point_id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::integer AS line_count,
              COALESCE(SUM(order_lines.quantity), 0)::integer AS total_quantity
            FROM order_lines
            WHERE order_lines.order_id = orders.id
              AND order_lines.status = 'ACTIVE'
          ) AS lines ON true
          LEFT JOIN LATERAL (
            SELECT activity_logs.created_at, activity_logs.actor_admin_user_id
            FROM activity_logs
            WHERE activity_logs.action = 'order.alert_acknowledged'
              AND activity_logs.entity_type = 'order'
              AND activity_logs.entity_id = orders.id
              AND activity_logs.actor_type = 'ADMIN'
              AND activity_logs.actor_admin_user_id IS NOT NULL
            ORDER BY activity_logs.created_at, activity_logs.id
            LIMIT 1
          ) AS acknowledgement ON true
          WHERE orders.status = 'PENDING'
            AND bills.status = 'OPEN'
            AND orders.idempotency_key NOT LIKE 'admin:%'
        `),
        pool.query<ServiceRequestAlertRow>(`
          SELECT
            service_requests.id AS service_request_id,
            service_requests.bill_id,
            service_requests.service_point_id,
            service_points.code AS service_point_code,
            service_points.name AS service_point_name,
            service_requests.message,
            service_requests.created_at,
            acknowledgement.created_at AS acknowledged_at,
            acknowledgement.actor_admin_user_id AS acknowledged_by_admin_user_id
          FROM service_requests
          INNER JOIN service_points ON service_points.id = service_requests.service_point_id
          LEFT JOIN LATERAL (
            SELECT activity_logs.created_at, activity_logs.actor_admin_user_id
            FROM activity_logs
            WHERE activity_logs.action = 'service_request.alert_acknowledged'
              AND activity_logs.entity_type = 'service_request'
              AND activity_logs.entity_id = service_requests.id
              AND activity_logs.actor_type = 'ADMIN'
              AND activity_logs.actor_admin_user_id IS NOT NULL
            ORDER BY activity_logs.created_at, activity_logs.id
            LIMIT 1
          ) AS acknowledgement ON true
          WHERE service_requests.status = 'PENDING'
        `),
      ]);

      const response = adminAlertsResponseSchema.parse({
        generatedAt: new Date().toISOString(),
        alerts: sortAdminAlerts([
          ...ordersResult.rows.map((row) => ({
            kind: 'ORDER' as const,
            orderId: row.order_id,
            billId: row.bill_id,
            servicePoint: {
              id: row.service_point_id,
              code: row.service_point_code,
              name: row.service_point_name,
            },
            note: row.note,
            totalVnd: row.total_vnd,
            lineCount: row.line_count,
            totalQuantity: row.total_quantity,
            createdAt: row.created_at.toISOString(),
            acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
            acknowledgedByAdminUserId: row.acknowledged_by_admin_user_id,
          })),
          ...serviceRequestsResult.rows.map((row) => ({
            kind: 'SERVICE_REQUEST' as const,
            serviceRequestId: row.service_request_id,
            billId: row.bill_id,
            servicePoint: {
              id: row.service_point_id,
              code: row.service_point_code,
              name: row.service_point_name,
            },
            message: row.message,
            createdAt: row.created_at.toISOString(),
            acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
            acknowledgedByAdminUserId: row.acknowledged_by_admin_user_id,
          })),
        ]),
      });

      return response;
    },

    async acknowledgeOrder(command) {
      const result = await withTransaction(pool, async (client) => {
        await acquireTransactionLock(client, `admin-alert:order:${command.orderId}`);

        const targetResult = await client.query<OrderTargetRow>(
          `
            SELECT
              orders.id,
              orders.venue_id,
              orders.service_point_id,
              orders.bill_id,
              orders.status,
              orders.idempotency_key,
              bills.status AS bill_status
            FROM orders
            INNER JOIN bills ON bills.id = orders.bill_id
            WHERE orders.id = $1
            LIMIT 1
            FOR UPDATE OF orders
          `,
          [command.orderId],
        );
        const target = targetResult.rows[0];

        if (!target) {
          throw new AdminAlertDomainError('ADMIN_ALERT_NOT_FOUND', 'Không tìm thấy order.');
        }

        if (
          target.status !== 'PENDING' ||
          target.bill_status !== 'OPEN' ||
          target.idempotency_key.startsWith('admin:')
        ) {
          throw new AdminAlertDomainError(
            'ADMIN_ALERT_NOT_ACTIVE',
            'Order không còn cần xác nhận cảnh báo.',
          );
        }

        const existing = await readExistingAcknowledgement(
          client,
          'order.alert_acknowledged',
          'order',
          target.id,
        );

        if (existing) {
          return {
            response: acknowledgeAdminAlertResponseSchema.parse({
              kind: 'ORDER',
              entityId: target.id,
              servicePointId: target.service_point_id,
              acknowledgedAt: existing.created_at.toISOString(),
              acknowledgedByAdminUserId: existing.actor_admin_user_id,
              replayed: true,
            }),
            event: null,
          };
        }

        const acknowledgement = await insertAcknowledgement(client, {
          venueId: target.venue_id,
          servicePointId: target.service_point_id,
          billId: target.bill_id,
          adminUserId: command.adminUserId,
          action: 'order.alert_acknowledged',
          entityType: 'order',
          entityId: target.id,
        });

        return {
          response: acknowledgeAdminAlertResponseSchema.parse({
            kind: 'ORDER',
            entityId: target.id,
            servicePointId: target.service_point_id,
            acknowledgedAt: acknowledgement.created_at.toISOString(),
            acknowledgedByAdminUserId: acknowledgement.actor_admin_user_id,
            replayed: false,
          }),
          event: adminRealtimeEventSchema.parse({
            type: 'order.alert-acknowledged',
            servicePointId: target.service_point_id,
            billId: target.bill_id,
            orderId: target.id,
          }),
        };
      });

      if (result.event) {
        publishBestEffort(eventPublisher, result.event);
      }

      return result.response;
    },

    async acknowledgeServiceRequest(command) {
      const result = await withTransaction(pool, async (client) => {
        await acquireTransactionLock(
          client,
          `admin-alert:service-request:${command.serviceRequestId}`,
        );

        const targetResult = await client.query<ServiceRequestTargetRow>(
          `
            SELECT id, venue_id, service_point_id, status
            FROM service_requests
            WHERE id = $1
            LIMIT 1
            FOR UPDATE
          `,
          [command.serviceRequestId],
        );
        const target = targetResult.rows[0];

        if (!target) {
          throw new AdminAlertDomainError(
            'ADMIN_ALERT_NOT_FOUND',
            'Không tìm thấy yêu cầu hỗ trợ.',
          );
        }

        if (target.status !== 'PENDING') {
          throw new AdminAlertDomainError(
            'ADMIN_ALERT_NOT_ACTIVE',
            'Yêu cầu hỗ trợ không còn cần xác nhận cảnh báo.',
          );
        }

        const existing = await readExistingAcknowledgement(
          client,
          'service_request.alert_acknowledged',
          'service_request',
          target.id,
        );

        if (existing) {
          return {
            response: acknowledgeAdminAlertResponseSchema.parse({
              kind: 'SERVICE_REQUEST',
              entityId: target.id,
              servicePointId: target.service_point_id,
              acknowledgedAt: existing.created_at.toISOString(),
              acknowledgedByAdminUserId: existing.actor_admin_user_id,
              replayed: true,
            }),
            event: null,
          };
        }

        const acknowledgement = await insertAcknowledgement(client, {
          venueId: target.venue_id,
          servicePointId: target.service_point_id,
          adminUserId: command.adminUserId,
          action: 'service_request.alert_acknowledged',
          entityType: 'service_request',
          entityId: target.id,
        });

        return {
          response: acknowledgeAdminAlertResponseSchema.parse({
            kind: 'SERVICE_REQUEST',
            entityId: target.id,
            servicePointId: target.service_point_id,
            acknowledgedAt: acknowledgement.created_at.toISOString(),
            acknowledgedByAdminUserId: acknowledgement.actor_admin_user_id,
            replayed: false,
          }),
          event: adminRealtimeEventSchema.parse({
            type: 'service-request.alert-acknowledged',
            servicePointId: target.service_point_id,
            serviceRequestId: target.id,
          }),
        };
      });

      if (result.event) {
        publishBestEffort(eventPublisher, result.event);
      }

      return result.response;
    },
  };
}
