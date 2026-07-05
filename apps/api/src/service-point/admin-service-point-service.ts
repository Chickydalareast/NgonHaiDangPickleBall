import {
  adminServicePointsResponseSchema,
  type AdminServicePointsResponse,
  type CreateAdminServicePointRequest,
  type UpdateAdminServicePointRequest,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import {
  buildCustomerServicePointUrl,
  createServicePointQrAsset,
  createServicePointQrPack,
  normalizePublicOrigin,
  type ServicePointQrAsset,
  type ServicePointQrPack,
} from './service-point-qr.js';

export type AdminServicePointErrorCode =
  | 'ADMIN_SERVICE_POINT_VENUE_NOT_FOUND'
  | 'ADMIN_SERVICE_POINT_NOT_FOUND'
  | 'ADMIN_SERVICE_POINT_SLUG_CONFLICT'
  | 'ADMIN_SERVICE_POINT_CODE_CONFLICT'
  | 'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_OPEN_BILL'
  | 'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_PENDING_REQUEST';

export class AdminServicePointDomainError extends Error {
  constructor(
    readonly code: AdminServicePointErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminServicePointDomainError';
  }
}

interface VenueRow extends QueryResultRow {
  id: string;
  name: string;
}

interface ServicePointRow extends QueryResultRow {
  id: string;
  venue_id: string;
  code: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'INACTIVE';
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

interface CountRow extends QueryResultRow {
  count: number;
}

export interface AdminServicePointService {
  getServicePoints(): Promise<AdminServicePointsResponse>;
  createServicePoint(input: {
    adminUserId: string;
    values: CreateAdminServicePointRequest;
  }): Promise<AdminServicePointsResponse>;
  updateServicePoint(input: {
    adminUserId: string;
    servicePointId: string;
    values: UpdateAdminServicePointRequest;
  }): Promise<AdminServicePointsResponse>;
  createQrAsset(servicePointId: string): Promise<ServicePointQrAsset>;
  createActiveQrPack(): Promise<ServicePointQrPack>;
}

async function readVenue(client: Pool | PoolClient): Promise<VenueRow> {
  const result = await client.query<VenueRow>(
    `
      SELECT id, name
      FROM venues
      WHERE status = 'ACTIVE'
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );
  const venue = result.rows[0];

  if (!venue) {
    throw new AdminServicePointDomainError(
      'ADMIN_SERVICE_POINT_VENUE_NOT_FOUND',
      'Không tìm thấy cơ sở đang hoạt động để quản lý sân.',
    );
  }

  return venue;
}

async function readServicePointRows(
  client: Pool | PoolClient,
  venueId: string,
  activeOnly = false,
): Promise<ServicePointRow[]> {
  const result = await client.query<ServicePointRow>(
    `
      SELECT
        id,
        venue_id,
        code,
        name,
        slug,
        status,
        sort_order,
        created_at,
        updated_at
      FROM service_points
      WHERE venue_id = $1
        AND ($2::boolean = false OR status = 'ACTIVE')
      ORDER BY sort_order ASC, name ASC, id ASC
    `,
    [venueId, activeOnly],
  );

  return result.rows;
}

async function requireServicePoint(
  client: Pool | PoolClient,
  servicePointId: string,
  venueId: string,
  lock = false,
): Promise<ServicePointRow> {
  const result = await client.query<ServicePointRow>(
    `
      SELECT
        id,
        venue_id,
        code,
        name,
        slug,
        status,
        sort_order,
        created_at,
        updated_at
      FROM service_points
      WHERE id = $1 AND venue_id = $2
      LIMIT 1
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [servicePointId, venueId],
  );
  const servicePoint = result.rows[0];

  if (!servicePoint) {
    throw new AdminServicePointDomainError('ADMIN_SERVICE_POINT_NOT_FOUND', 'Không tìm thấy sân.');
  }

  return servicePoint;
}

function mapResponse(
  venue: VenueRow,
  rows: ServicePointRow[],
  publicOrigin: string,
): AdminServicePointsResponse {
  return adminServicePointsResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    publicOrigin,
    venue: {
      id: venue.id,
      name: venue.name,
    },
    servicePoints: rows.map((row) => ({
      id: row.id,
      venueId: row.venue_id,
      code: row.code,
      name: row.name,
      slug: row.slug,
      status: row.status,
      sortOrder: row.sort_order,
      customerUrl: buildCustomerServicePointUrl(publicOrigin, row.slug),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
  });
}

async function loadServicePoints(
  pool: Pool,
  publicOrigin: string,
): Promise<AdminServicePointsResponse> {
  const venue = await readVenue(pool);
  const rows = await readServicePointRows(pool, venue.id);
  return mapResponse(venue, rows, publicOrigin);
}

async function insertActivityLog(
  client: PoolClient,
  input: {
    venueId: string;
    adminUserId: string;
    action: string;
    servicePointId: string;
    metadata?: Record<string, unknown>;
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
      VALUES ($1, 'ADMIN', $2, $3, 'SERVICE_POINT', $4, $5::jsonb)
    `,
    [
      input.venueId,
      input.adminUserId,
      input.action,
      input.servicePointId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function assertCanDeactivate(client: PoolClient, servicePointId: string): Promise<void> {
  const openBillResult = await client.query<CountRow>(
    `
      SELECT count(*)::int AS count
      FROM bills
      WHERE service_point_id = $1 AND status = 'OPEN'
    `,
    [servicePointId],
  );

  if ((openBillResult.rows[0]?.count ?? 0) > 0) {
    throw new AdminServicePointDomainError(
      'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_OPEN_BILL',
      'Không thể tắt sân khi vẫn còn bill đang mở.',
    );
  }

  const pendingRequestResult = await client.query<CountRow>(
    `
      SELECT count(*)::int AS count
      FROM service_requests
      WHERE service_point_id = $1 AND status = 'PENDING'
    `,
    [servicePointId],
  );

  if ((pendingRequestResult.rows[0]?.count ?? 0) > 0) {
    throw new AdminServicePointDomainError(
      'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_PENDING_REQUEST',
      'Không thể tắt sân khi vẫn còn yêu cầu gọi nhân viên đang chờ.',
    );
  }
}

function rethrowUniqueConstraint(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error
  ) {
    if (error.constraint === 'service_points_slug_unique') {
      throw new AdminServicePointDomainError(
        'ADMIN_SERVICE_POINT_SLUG_CONFLICT',
        'Slug sân đã được sử dụng.',
      );
    }

    if (error.constraint === 'service_points_venue_code_unique') {
      throw new AdminServicePointDomainError(
        'ADMIN_SERVICE_POINT_CODE_CONFLICT',
        'Mã sân đã được sử dụng trong cơ sở này.',
      );
    }
  }

  throw error;
}

export function createAdminServicePointService(
  pool: Pool,
  publicOriginInput: string,
): AdminServicePointService {
  const publicOrigin = normalizePublicOrigin(publicOriginInput);

  return {
    getServicePoints() {
      return loadServicePoints(pool, publicOrigin);
    },

    async createServicePoint(input) {
      try {
        await withTransaction(pool, async (client) => {
          const venue = await readVenue(client);
          const result = await client.query<{ id: string }>(
            `
              INSERT INTO service_points (
                venue_id,
                code,
                name,
                slug,
                status,
                sort_order
              )
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id
            `,
            [
              venue.id,
              input.values.code,
              input.values.name,
              input.values.slug,
              input.values.status,
              input.values.sortOrder,
            ],
          );
          const created = result.rows[0];

          if (!created) {
            throw new Error('Service point insert did not return an id.');
          }

          await insertActivityLog(client, {
            venueId: venue.id,
            adminUserId: input.adminUserId,
            action: 'service-point.created',
            servicePointId: created.id,
            metadata: {
              code: input.values.code,
              slug: input.values.slug,
              status: input.values.status,
            },
          });
        });
      } catch (error) {
        rethrowUniqueConstraint(error);
      }

      return loadServicePoints(pool, publicOrigin);
    },

    async updateServicePoint(input) {
      try {
        await withTransaction(pool, async (client) => {
          const venue = await readVenue(client);
          const current = await requireServicePoint(client, input.servicePointId, venue.id, true);
          const next = {
            code: input.values.code ?? current.code,
            name: input.values.name ?? current.name,
            status: input.values.status ?? current.status,
            sortOrder: input.values.sortOrder ?? current.sort_order,
          };

          if (current.status === 'ACTIVE' && next.status === 'INACTIVE') {
            await assertCanDeactivate(client, current.id);
          }

          await client.query(
            `
              UPDATE service_points
              SET
                code = $1,
                name = $2,
                status = $3,
                sort_order = $4,
                updated_at = now()
              WHERE id = $5 AND venue_id = $6
            `,
            [next.code, next.name, next.status, next.sortOrder, current.id, venue.id],
          );

          await insertActivityLog(client, {
            venueId: venue.id,
            adminUserId: input.adminUserId,
            action: 'service-point.updated',
            servicePointId: current.id,
            metadata: {
              before: {
                code: current.code,
                name: current.name,
                status: current.status,
                sortOrder: current.sort_order,
              },
              after: next,
            },
          });
        });
      } catch (error) {
        if (error instanceof AdminServicePointDomainError) {
          throw error;
        }
        rethrowUniqueConstraint(error);
      }

      return loadServicePoints(pool, publicOrigin);
    },

    async createQrAsset(servicePointId) {
      const venue = await readVenue(pool);
      const servicePoint = await requireServicePoint(pool, servicePointId, venue.id);
      return createServicePointQrAsset(publicOrigin, {
        id: servicePoint.id,
        code: servicePoint.code,
        name: servicePoint.name,
        slug: servicePoint.slug,
        status: servicePoint.status,
      });
    },

    async createActiveQrPack() {
      const venue = await readVenue(pool);
      const rows = await readServicePointRows(pool, venue.id, true);
      return createServicePointQrPack(
        publicOrigin,
        rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          slug: row.slug,
          status: row.status,
        })),
      );
    },
  };
}
