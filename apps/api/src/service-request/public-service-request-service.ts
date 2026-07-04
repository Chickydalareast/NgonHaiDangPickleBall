import {
  adminRealtimeEventSchema,
  createPublicServiceRequestResponseSchema,
  pendingServiceRequestSchema,
  readPendingServiceRequestResponseSchema,
  type AdminRealtimeEvent,
  type CreatePublicServiceRequestRequest,
  type CreatePublicServiceRequestResponse,
  type ReadPendingServiceRequestResponse,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';

export type PublicServiceRequestErrorCode = 'SERVICE_POINT_NOT_FOUND';

export class PublicServiceRequestDomainError extends Error {
  constructor(
    readonly code: PublicServiceRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PublicServiceRequestDomainError';
  }
}

export interface PublicServiceRequestService {
  readPending(servicePointSlug: string): Promise<ReadPendingServiceRequestResponse>;
  create(command: {
    servicePointSlug: string;
    request: CreatePublicServiceRequestRequest;
  }): Promise<CreatePublicServiceRequestResponse>;
}

interface ServicePointRow extends QueryResultRow {
  id: string;
  venue_id: string;
}

interface PendingRequestRow extends QueryResultRow {
  id: string;
  service_point_id: string;
  bill_id: string | null;
  message: string | null;
  created_at: Date;
}

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

async function readPendingByServicePointId(
  client: Pick<PoolClient, 'query'>,
  servicePointId: string,
  lock = false,
): Promise<PendingRequestRow | null> {
  const result = await client.query<PendingRequestRow>(
    `
      SELECT id, service_point_id, bill_id, message, created_at
      FROM service_requests
      WHERE service_point_id = $1
        AND status = 'PENDING'
      ORDER BY created_at, id
      LIMIT 1
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [servicePointId],
  );

  return result.rows[0] ?? null;
}

function toPendingResponse(row: PendingRequestRow) {
  return pendingServiceRequestSchema.parse({
    id: row.id,
    servicePointId: row.service_point_id,
    billId: row.bill_id,
    status: 'PENDING',
    message: row.message,
    createdAt: row.created_at.toISOString(),
  });
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
    // Realtime is advisory and must not roll back a committed request.
  }
}

export function createPublicServiceRequestService(
  pool: Pool,
  eventPublisher?: OrderCreatedEventPublisher,
): PublicServiceRequestService {
  return {
    async readPending(servicePointSlug) {
      const client = await pool.connect();

      try {
        const servicePoint = await findActiveServicePoint(client, servicePointSlug);

        if (!servicePoint) {
          throw new PublicServiceRequestDomainError(
            'SERVICE_POINT_NOT_FOUND',
            'Không tìm thấy sân hoặc sân hiện không hoạt động.',
          );
        }

        const pending = await readPendingByServicePointId(client, servicePoint.id);

        return readPendingServiceRequestResponseSchema.parse({
          request: pending ? toPendingResponse(pending) : null,
        });
      } finally {
        client.release();
      }
    },

    async create(command) {
      const result = await withTransaction(pool, async (client) => {
        const servicePoint = await findActiveServicePoint(client, command.servicePointSlug);

        if (!servicePoint) {
          throw new PublicServiceRequestDomainError(
            'SERVICE_POINT_NOT_FOUND',
            'Không tìm thấy sân hoặc sân hiện không hoạt động.',
          );
        }

        await acquireTransactionLock(client, `service-request:${servicePoint.id}`);

        const existing = await readPendingByServicePointId(client, servicePoint.id, true);

        if (existing) {
          return {
            response: createPublicServiceRequestResponseSchema.parse({
              replayed: true,
              request: toPendingResponse(existing),
            }),
            event: null,
          };
        }

        const openBillResult = await client.query<{ id: string } & QueryResultRow>(
          `
            SELECT id
            FROM bills
            WHERE service_point_id = $1
              AND status = 'OPEN'
            LIMIT 1
          `,
          [servicePoint.id],
        );
        const billId = openBillResult.rows[0]?.id ?? null;
        const createdResult = await client.query<PendingRequestRow>(
          `
            INSERT INTO service_requests (
              venue_id,
              service_point_id,
              bill_id,
              status,
              message
            )
            VALUES ($1, $2, $3, 'PENDING', $4)
            RETURNING id, service_point_id, bill_id, message, created_at
          `,
          [servicePoint.venue_id, servicePoint.id, billId, command.request.message ?? null],
        );
        const created = createdResult.rows[0];

        if (!created) {
          throw new Error('PostgreSQL did not return the created service request.');
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
            VALUES ($1, 'CUSTOMER', 'service_request.created', 'service_request', $2, $3::jsonb)
          `,
          [
            servicePoint.venue_id,
            created.id,
            JSON.stringify({
              servicePointId: servicePoint.id,
              billId,
              message: created.message,
            }),
          ],
        );

        const event = adminRealtimeEventSchema.parse({
          type: 'service-request.created',
          servicePointId: servicePoint.id,
          serviceRequestId: created.id,
        });

        return {
          response: createPublicServiceRequestResponseSchema.parse({
            replayed: false,
            request: toPendingResponse(created),
          }),
          event,
        };
      });

      if (result.event) {
        publishBestEffort(eventPublisher, result.event);
      }

      return result.response;
    },
  };
}
