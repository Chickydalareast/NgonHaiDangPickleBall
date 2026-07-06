import assert from 'node:assert/strict';

import type { AdminRealtimeEvent } from '@nhdp/contracts';
import { Client } from 'pg';

import { createAdminDashboardRepository } from '../admin/admin-dashboard-repository.js';
import { createAdminRealtimeHub } from '../admin/admin-realtime-hub.js';
import {
  AdminServiceRequestDomainError,
  createAdminServiceRequestService,
} from '../admin/admin-service-request-service.js';
import { readDatabaseEnvironment, readSeedEnvironment } from '../config/database-environment.js';
import { dropVerificationDatabase } from '../db/verification-database.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createPublicServiceRequestService } from './public-service-request-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const seedEnvironment = readSeedEnvironment();
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const databaseName = `nhdp_step9_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${databaseName}`;
  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step9-admin-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());
    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step9-verifier',
      maxConnections: 12,
    });
    const hub = createAdminRealtimeHub();
    const events: AdminRealtimeEvent[] = [];
    const unsubscribe = hub.subscribe({
      send(event) {
        events.push(event);
      },
      close() {
        return;
      },
    });

    try {
      const admin = (
        await database.pool.query<{ id: string }>(
          `
          SELECT id
          FROM admin_users
          WHERE username = $1
          LIMIT 1
        `,
          [seedEnvironment.ADMIN_SEED_USERNAME],
        )
      ).rows[0];
      const servicePoint = (
        await database.pool.query<{ id: string; slug: string }>(
          `SELECT id, slug FROM service_points WHERE slug = 'san-01' LIMIT 1`,
        )
      ).rows[0];
      assert.ok(admin);
      assert.ok(servicePoint);

      const publicService = createPublicServiceRequestService(database.pool, hub);
      const adminService = createAdminServiceRequestService(database.pool, hub);
      const dashboard = createAdminDashboardRepository(database.pool);

      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          publicService.create({
            servicePointSlug: servicePoint.slug,
            request: { message: 'Cần nhân viên hỗ trợ tại sân' },
          }),
        ),
      );
      const requestIds = new Set(attempts.map((attempt) => attempt.request.id));
      assert.equal(requestIds.size, 1);
      assert.equal(attempts.filter((attempt) => !attempt.replayed).length, 1);
      assert.equal(attempts.filter((attempt) => attempt.replayed).length, 7);
      const firstRequestId = attempts[0]?.request.id;
      assert.ok(firstRequestId);

      const pending = await publicService.readPending(servicePoint.slug);
      assert.equal(pending.request?.id, firstRequestId);
      assert.equal(pending.request?.billId, null);

      const dashboardSnapshot = await dashboard.read();
      const court = dashboardSnapshot.servicePoints.find((entry) => entry.id === servicePoint.id);
      assert.equal(court?.hasPendingServiceRequest, true);
      assert.equal(court?.pendingServiceRequest?.id, firstRequestId);
      assert.equal(court?.pendingServiceRequest?.message, 'Cần nhân viên hỗ trợ tại sân');

      const resolved = await adminService.resolve({
        adminUserId: admin.id,
        serviceRequestId: firstRequestId,
      });
      assert.equal(resolved.status, 'RESOLVED');

      await assert.rejects(
        adminService.resolve({
          adminUserId: admin.id,
          serviceRequestId: firstRequestId,
        }),
        (error: unknown) =>
          error instanceof AdminServiceRequestDomainError &&
          error.code === 'ADMIN_SERVICE_REQUEST_NOT_PENDING',
      );

      assert.equal((await publicService.readPending(servicePoint.slug)).request, null);

      const second = await publicService.create({
        servicePointSlug: servicePoint.slug,
        request: {},
      });
      assert.equal(second.replayed, false);
      assert.notEqual(second.request.id, firstRequestId);

      const storedCounts = (
        await database.pool.query<{
          pending_count: number;
          resolved_count: number;
          activity_count: number;
        }>(
          `
            SELECT
              COUNT(*) FILTER (WHERE status = 'PENDING')::integer AS pending_count,
              COUNT(*) FILTER (WHERE status = 'RESOLVED')::integer AS resolved_count,
              (
                SELECT COUNT(*)::integer
                FROM activity_logs
                WHERE action IN ('service_request.created', 'service_request.resolved')
              ) AS activity_count
            FROM service_requests
            WHERE service_point_id = $1
          `,
          [servicePoint.id],
        )
      ).rows[0];
      assert.equal(storedCounts?.pending_count, 1);
      assert.equal(storedCounts?.resolved_count, 1);
      assert.equal(storedCounts?.activity_count, 3);

      assert.equal(events.filter((event) => event.type === 'service-request.created').length, 2);
      assert.equal(events.filter((event) => event.type === 'service-request.resolved').length, 1);

      console.log('Call staff database verification PASS.');
      console.log(
        JSON.stringify(
          {
            concurrentAttempts: attempts.length,
            singlePendingRequest: requestIds.size === 1,
            replayedAttempts: attempts.filter((attempt) => attempt.replayed).length,
            resolvedRequestId: resolved.id,
            newRequestAfterResolve: second.request.id !== firstRequestId,
            eventTypes: events.map((event) => event.type),
          },
          null,
          2,
        ),
      );
    } finally {
      unsubscribe();
      hub.close();
      await database.pool.end();
    }
  } finally {
    await dropVerificationDatabase(adminClient, databaseName);
    await adminClient.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
