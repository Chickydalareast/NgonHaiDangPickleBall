import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import jsQrModule from 'jsqr';
import { PNG } from 'pngjs';

type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

const decodeQr = jsQrModule as unknown as JsQrDecoder;

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import {
  AdminServicePointDomainError,
  createAdminServicePointService,
} from './admin-service-point-service.js';

function decodePngQr(pngBuffer: Buffer): string {
  const png = PNG.sync.read(pngBuffer);
  const decoded = decodeQr(Uint8ClampedArray.from(png.data), png.width, png.height);
  assert.ok(decoded, 'Expected generated service point PNG to decode as QR.');
  return decoded.data;
}

async function main(): Promise<void> {
  const environment = readDatabaseEnvironment();
  const { pool } = createDatabaseConnection(environment.DATABASE_URL, {
    applicationName: 'nhdp-step10pro-a-db-verifier',
    maxConnections: 3,
  });
  const service = createAdminServicePointService(pool, 'http://localhost:8080');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  let servicePointId: string | null = null;
  let openBillId: string | null = null;
  let serviceRequestId: string | null = null;

  try {
    const adminResult = await pool.query<{ id: string }>(
      `SELECT id FROM admin_users WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1`,
    );
    const adminUserId = adminResult.rows[0]?.id;
    assert.ok(adminUserId, 'Expected an active admin user for verification.');

    const initial = await service.getServicePoints();
    const seededCourts = initial.servicePoints.filter((entry) =>
      /^san-(0[1-9]|10)$/.test(entry.slug),
    );
    assert.equal(seededCourts.length, 10, 'Expected seeded courts san-01 through san-10.');
    assert.equal(new Set(seededCourts.map((entry) => entry.slug)).size, 10);
    assert.equal(new Set(seededCourts.map((entry) => entry.code)).size, 10);

    const created = await service.createServicePoint({
      adminUserId,
      values: {
        code: `VERIFY-${suffix}`,
        name: 'Sân verify Step 10.PRO-A',
        slug: `verify-${suffix.toLowerCase()}`,
        status: 'ACTIVE',
        sortOrder: 999_000,
      },
    });
    const servicePoint = created.servicePoints.find(
      (entry) => entry.slug === `verify-${suffix.toLowerCase()}`,
    );
    assert.ok(servicePoint);
    servicePointId = servicePoint.id;

    const qrAsset = await service.createQrAsset(servicePointId);
    assert.equal(decodePngQr(qrAsset.png), servicePoint.customerUrl);

    const billResult = await pool.query<{ id: string }>(
      `
        INSERT INTO bills (venue_id, service_point_id, status, subtotal_vnd, total_vnd)
        VALUES ($1, $2, 'OPEN', 0, 0)
        RETURNING id
      `,
      [servicePoint.venueId, servicePointId],
    );
    openBillId = billResult.rows[0]?.id ?? null;
    assert.ok(openBillId);

    await assert.rejects(
      service.updateServicePoint({
        adminUserId,
        servicePointId,
        values: { status: 'INACTIVE' },
      }),
      (error: unknown) =>
        error instanceof AdminServicePointDomainError &&
        error.code === 'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_OPEN_BILL',
    );

    await pool.query(`DELETE FROM bills WHERE id = $1`, [openBillId]);
    openBillId = null;

    const requestResult = await pool.query<{ id: string }>(
      `
        INSERT INTO service_requests (venue_id, service_point_id, status, message)
        VALUES ($1, $2, 'PENDING', 'verify deactivation guard')
        RETURNING id
      `,
      [servicePoint.venueId, servicePointId],
    );
    serviceRequestId = requestResult.rows[0]?.id ?? null;
    assert.ok(serviceRequestId);

    await assert.rejects(
      service.updateServicePoint({
        adminUserId,
        servicePointId,
        values: { status: 'INACTIVE' },
      }),
      (error: unknown) =>
        error instanceof AdminServicePointDomainError &&
        error.code === 'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_PENDING_REQUEST',
    );

    await pool.query(`DELETE FROM service_requests WHERE id = $1`, [serviceRequestId]);
    serviceRequestId = null;

    const updated = await service.updateServicePoint({
      adminUserId,
      servicePointId,
      values: {
        name: 'Sân verify đã cập nhật',
        status: 'INACTIVE',
        sortOrder: 999_100,
      },
    });
    const inactive = updated.servicePoints.find((entry) => entry.id === servicePointId);
    assert.equal(inactive?.status, 'INACTIVE');
    assert.equal(inactive?.slug, servicePoint.slug, 'Service point slug must remain immutable.');

    const activePack = await service.createActiveQrPack();
    assert.equal(
      activePack.manifest.servicePoints.some((entry) => entry.servicePointId === servicePointId),
      false,
      'Inactive service points must not be included in the printable QR pack.',
    );
    assert.equal(activePack.manifest.servicePoints.length >= 10, true);

    const activityResult = await pool.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM activity_logs
        WHERE entity_type = 'SERVICE_POINT' AND entity_id = $1
      `,
      [servicePointId],
    );
    assert.equal((activityResult.rows[0]?.count ?? 0) >= 2, true);

    console.log('Admin service points and QR database verification PASS.');
    console.log(
      JSON.stringify(
        {
          seededCourts: seededCourts.length,
          servicePointId,
          qrDecoded: true,
          slugImmutable: true,
          openBillDeactivationBlocked: true,
          pendingRequestDeactivationBlocked: true,
          inactiveExcludedFromQrPack: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (serviceRequestId) {
      await pool.query(`DELETE FROM service_requests WHERE id = $1`, [serviceRequestId]);
    }
    if (openBillId) {
      await pool.query(`DELETE FROM bills WHERE id = $1`, [openBillId]);
    }
    if (servicePointId) {
      await pool.query(`DELETE FROM activity_logs WHERE entity_id = $1`, [servicePointId]);
      await pool.query(`DELETE FROM service_points WHERE id = $1`, [servicePointId]);
    }
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
