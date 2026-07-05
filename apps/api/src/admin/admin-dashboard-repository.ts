import { adminDashboardResponseSchema, type AdminDashboardResponse } from '@nhdp/contracts';
import type { Pool, QueryResultRow } from 'pg';

export interface AdminDashboardRepository {
  read(): Promise<AdminDashboardResponse>;
}

interface DashboardRow extends QueryResultRow {
  id: string;
  venue_id: string;
  venue_name: string;
  code: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  open_bill_id: string | null;
  open_bill_total_vnd: number | null;
  open_bill_opened_at: Date | null;
  open_bill_has_activity: boolean;
  pending_order_count: number;
  pending_service_request_id: string | null;
  pending_service_request_message: string | null;
  pending_service_request_created_at: Date | null;
}

export function createAdminDashboardRepository(pool: Pool): AdminDashboardRepository {
  return {
    async read() {
      const result = await pool.query<DashboardRow>(`
        SELECT
          service_points.id,
          service_points.venue_id,
          venues.name AS venue_name,
          service_points.code,
          service_points.slug,
          service_points.name,
          service_points.status,
          open_bill.id AS open_bill_id,
          open_bill.total_vnd AS open_bill_total_vnd,
          open_bill.opened_at AS open_bill_opened_at,
          EXISTS (
            SELECT 1
            FROM order_lines
            WHERE order_lines.bill_id = open_bill.id
          ) AS open_bill_has_activity,
          COALESCE((
            SELECT COUNT(*)::integer
            FROM orders
            WHERE orders.bill_id = open_bill.id
              AND orders.status = 'PENDING'
          ), 0)::integer AS pending_order_count,
          pending_request.id AS pending_service_request_id,
          pending_request.message AS pending_service_request_message,
          pending_request.created_at AS pending_service_request_created_at
        FROM service_points
        INNER JOIN venues
          ON venues.id = service_points.venue_id
        LEFT JOIN bills AS open_bill
          ON open_bill.service_point_id = service_points.id
         AND open_bill.status = 'OPEN'
        LEFT JOIN LATERAL (
          SELECT id, message, created_at
          FROM service_requests
          WHERE service_requests.service_point_id = service_points.id
            AND service_requests.status = 'PENDING'
          ORDER BY service_requests.created_at, service_requests.id
          LIMIT 1
        ) AS pending_request ON true
        ORDER BY
          service_points.sort_order,
          service_points.name,
          service_points.id
      `);

      return adminDashboardResponseSchema.parse({
        generatedAt: new Date().toISOString(),
        servicePoints: result.rows.map((row) => ({
          id: row.id,
          venueId: row.venue_id,
          venueName: row.venue_name,
          code: row.code,
          slug: row.slug,
          name: row.name,
          status: row.status,
          billLifecycleState: !row.open_bill_id
            ? 'NONE'
            : row.open_bill_has_activity
              ? 'OPEN_ACTIVE'
              : 'OPEN_EMPTY',
          openBill:
            row.open_bill_id && row.open_bill_total_vnd !== null && row.open_bill_opened_at
              ? {
                  id: row.open_bill_id,
                  totalVnd: row.open_bill_total_vnd,
                  openedAt: row.open_bill_opened_at.toISOString(),
                }
              : null,
          pendingOrderCount: row.pending_order_count,
          hasPendingServiceRequest: row.pending_service_request_id !== null,
          pendingServiceRequest:
            row.pending_service_request_id && row.pending_service_request_created_at
              ? {
                  id: row.pending_service_request_id,
                  message: row.pending_service_request_message,
                  createdAt: row.pending_service_request_created_at.toISOString(),
                }
              : null,
        })),
      });
    },
  };
}
