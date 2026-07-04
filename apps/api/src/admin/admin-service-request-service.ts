import {
  adminRealtimeEventSchema,
  resolveAdminServiceRequestResponseSchema,
  type AdminRealtimeEvent,
  type ResolveAdminServiceRequestResponse,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { OrderCreatedEventPublisher } from '../order/create-order-service.js';

export type AdminServiceRequestErrorCode =
  'ADMIN_SERVICE_REQUEST_NOT_FOUND' | 'ADMIN_SERVICE_REQUEST_NOT_PENDING';

export class AdminServiceRequestDomainError extends Error {
  constructor(
    readonly code: AdminServiceRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminServiceRequestDomainError';
  }
}

export interface AdminServiceRequestService {
  resolve(command: {
    adminUserId: string;
    serviceRequestId: string;
  }): Promise<ResolveAdminServiceRequestResponse>;
}

interface RequestReferenceRow extends QueryResultRow {
  service_point_id: string;
}

interface LockedRequestRow extends QueryResultRow {
  id: string;
  venue_id: string;
  service_point_id: string;
  status: 'PENDING' | 'RESOLVED' | 'CANCELLED';
}

interface ResolvedRequestRow extends QueryResultRow {
  id: string;
  service_point_id: string;
  resolved_at: Date;
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
    // Realtime is advisory and must not roll back a committed resolution.
  }
}

export function createAdminServiceRequestService(
  pool: Pool,
  eventPublisher?: OrderCreatedEventPublisher,
): AdminServiceRequestService {
  return {
    async resolve(command) {
      const result = await withTransaction(pool, async (client) => {
        const referenceResult = await client.query<RequestReferenceRow>(
          `
            SELECT service_point_id
            FROM service_requests
            WHERE id = $1
            LIMIT 1
          `,
          [command.serviceRequestId],
        );
        const reference = referenceResult.rows[0];

        if (!reference) {
          throw new AdminServiceRequestDomainError(
            'ADMIN_SERVICE_REQUEST_NOT_FOUND',
            'Không tìm thấy yêu cầu hỗ trợ.',
          );
        }

        await acquireTransactionLock(client, `service-request:${reference.service_point_id}`);

        const requestResult = await client.query<LockedRequestRow>(
          `
            SELECT id, venue_id, service_point_id, status
            FROM service_requests
            WHERE id = $1
            FOR UPDATE
          `,
          [command.serviceRequestId],
        );
        const serviceRequest = requestResult.rows[0];

        if (!serviceRequest) {
          throw new AdminServiceRequestDomainError(
            'ADMIN_SERVICE_REQUEST_NOT_FOUND',
            'Không tìm thấy yêu cầu hỗ trợ.',
          );
        }

        if (serviceRequest.status !== 'PENDING') {
          throw new AdminServiceRequestDomainError(
            'ADMIN_SERVICE_REQUEST_NOT_PENDING',
            'Yêu cầu hỗ trợ không còn ở trạng thái chờ.',
          );
        }

        const resolvedResult = await client.query<ResolvedRequestRow>(
          `
            UPDATE service_requests
            SET status = 'RESOLVED',
                resolved_at = now(),
                updated_at = now()
            WHERE id = $1
              AND status = 'PENDING'
            RETURNING id, service_point_id, resolved_at
          `,
          [serviceRequest.id],
        );
        const resolved = resolvedResult.rows[0];

        if (!resolved) {
          throw new AdminServiceRequestDomainError(
            'ADMIN_SERVICE_REQUEST_NOT_PENDING',
            'Yêu cầu hỗ trợ không còn ở trạng thái chờ.',
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
            VALUES ($1, 'ADMIN', $2, 'service_request.resolved', 'service_request', $3, $4::jsonb)
          `,
          [
            serviceRequest.venue_id,
            command.adminUserId,
            serviceRequest.id,
            JSON.stringify({ servicePointId: serviceRequest.service_point_id }),
          ],
        );

        const response = resolveAdminServiceRequestResponseSchema.parse({
          id: resolved.id,
          servicePointId: resolved.service_point_id,
          status: 'RESOLVED',
          resolvedAt: resolved.resolved_at.toISOString(),
        });
        const event = adminRealtimeEventSchema.parse({
          type: 'service-request.resolved',
          servicePointId: resolved.service_point_id,
          serviceRequestId: resolved.id,
        });

        return { response, event };
      });

      publishBestEffort(eventPublisher, result.event);
      return result.response;
    },
  };
}
