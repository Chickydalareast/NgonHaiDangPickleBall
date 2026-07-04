import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

import { readDatabaseEnvironment, readSeedEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { seedDatabase } from '../db/seed-service.js';
import {
  createAdminAuthService,
  hashAdminSessionToken,
  InvalidCredentialsError,
} from './admin-auth-service.js';
import { createAdminDashboardRepository } from './admin-dashboard-repository.js';

const verificationEnvironmentSchema = z.object({
  SESSION_SECRET: z.string().min(32),
});

interface AdminRow {
  id: string;
  password_hash: string;
  status: 'ACTIVE' | 'INACTIVE';
}

async function main(): Promise<void> {
  const databaseEnvironment = readDatabaseEnvironment();
  const seedEnvironment = readSeedEnvironment();
  const verificationEnvironment = verificationEnvironmentSchema.parse(process.env);
  const { pool } = createDatabaseConnection(databaseEnvironment.DATABASE_URL, {
    applicationName: 'nhdp-step5-verifier',
    maxConnections: Math.min(databaseEnvironment.DATABASE_POOL_MAX, 3),
  });
  const authService = createAdminAuthService(pool, verificationEnvironment.SESSION_SECRET);
  const dashboardRepository = createAdminDashboardRepository(pool);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const sessionHashes: string[] = [];
  let adminId: string | null = null;
  let venueId: string | null = null;
  let servicePointId: string | null = null;

  try {
    const initialAdminResult = await pool.query<AdminRow>(
      `
        SELECT id, password_hash, status
        FROM admin_users
        WHERE username = $1
        LIMIT 1
      `,
      [seedEnvironment.ADMIN_SEED_USERNAME],
    );
    const initialAdmin = initialAdminResult.rows[0];

    assert.ok(initialAdmin, 'Seed admin is missing after migration and seed.');
    adminId = initialAdmin.id;
    assert.equal(initialAdmin.status, 'ACTIVE');
    assert.ok(initialAdmin.password_hash.startsWith('$argon2id$'));
    assert.equal(
      await verify(initialAdmin.password_hash, seedEnvironment.ADMIN_SEED_PASSWORD),
      true,
    );

    await seedDatabase(databaseEnvironment.DATABASE_URL);

    const reseededAdminResult = await pool.query<AdminRow>(
      `
        SELECT id, password_hash, status
        FROM admin_users
        WHERE username = $1
        LIMIT 1
      `,
      [seedEnvironment.ADMIN_SEED_USERNAME],
    );
    const reseededAdmin = reseededAdminResult.rows[0];

    assert.ok(reseededAdmin);
    assert.equal(reseededAdmin.id, initialAdmin.id);
    assert.equal(reseededAdmin.password_hash, initialAdmin.password_hash);

    await assert.rejects(
      authService.login({
        username: seedEnvironment.ADMIN_SEED_USERNAME,
        password: 'definitely-wrong-password',
      }),
      InvalidCredentialsError,
    );
    await assert.rejects(
      authService.login({
        username: `missing-${suffix}`,
        password: seedEnvironment.ADMIN_SEED_PASSWORD,
      }),
      InvalidCredentialsError,
    );

    const activeLogin = await authService.login({
      username: seedEnvironment.ADMIN_SEED_USERNAME,
      password: seedEnvironment.ADMIN_SEED_PASSWORD,
    });
    const activeHash = hashAdminSessionToken(
      activeLogin.rawToken,
      verificationEnvironment.SESSION_SECRET,
    );
    sessionHashes.push(activeHash);

    assert.notEqual(activeLogin.rawToken, activeHash);

    const storedSessionResult = await pool.query<{
      token_hash: string;
      revoked_at: Date | null;
    }>(
      `
        SELECT token_hash, revoked_at
        FROM admin_sessions
        WHERE token_hash = $1
      `,
      [activeHash],
    );

    assert.equal(storedSessionResult.rows[0]?.token_hash, activeHash);
    assert.equal(storedSessionResult.rows[0]?.revoked_at, null);
    assert.deepEqual(await authService.restore(activeLogin.rawToken), activeLogin.session);
    assert.equal(await authService.restore('not-a-valid-token'), null);

    await pool.query(
      `UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [activeHash],
    );
    assert.equal(await authService.restore(activeLogin.rawToken), null);

    const revokedLogin = await authService.login({
      username: seedEnvironment.ADMIN_SEED_USERNAME,
      password: seedEnvironment.ADMIN_SEED_PASSWORD,
    });
    const revokedHash = hashAdminSessionToken(
      revokedLogin.rawToken,
      verificationEnvironment.SESSION_SECRET,
    );
    sessionHashes.push(revokedHash);
    await authService.revoke(revokedLogin.rawToken);
    assert.equal(await authService.restore(revokedLogin.rawToken), null);

    const inactiveLogin = await authService.login({
      username: seedEnvironment.ADMIN_SEED_USERNAME,
      password: seedEnvironment.ADMIN_SEED_PASSWORD,
    });
    const inactiveHash = hashAdminSessionToken(
      inactiveLogin.rawToken,
      verificationEnvironment.SESSION_SECRET,
    );
    sessionHashes.push(inactiveHash);

    await pool.query(
      `UPDATE admin_users SET status = 'INACTIVE', updated_at = now() WHERE id = $1`,
      [adminId],
    );
    assert.equal(await authService.restore(inactiveLogin.rawToken), null);
    await assert.rejects(
      authService.login({
        username: seedEnvironment.ADMIN_SEED_USERNAME,
        password: seedEnvironment.ADMIN_SEED_PASSWORD,
      }),
      InvalidCredentialsError,
    );
    await pool.query(`UPDATE admin_users SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [
      adminId,
    ]);

    const temporaryPasswordHash = await hash('temporary-verification-password', {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    await assert.rejects(
      pool.query(
        `
          INSERT INTO admin_users (
            username,
            password_hash,
            display_name,
            role,
            status
          )
          VALUES ('Invalid Username', $1, 'Invalid', 'ADMIN', 'ACTIVE')
        `,
        [temporaryPasswordHash],
      ),
    );
    await assert.rejects(
      pool.query(
        `
          INSERT INTO admin_users (
            username,
            password_hash,
            display_name,
            role,
            status
          )
          VALUES ($1, $2, 'Duplicate', 'ADMIN', 'ACTIVE')
        `,
        [seedEnvironment.ADMIN_SEED_USERNAME, temporaryPasswordHash],
      ),
    );

    const venueResult = await pool.query<{ id: string }>(
      `
        INSERT INTO venues (name, slug, timezone, currency, status)
        VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'VND', 'ACTIVE')
        RETURNING id
      `,
      [`Verification Venue ${suffix}`, `verify-admin-${suffix}`],
    );
    venueId = venueResult.rows[0]?.id ?? null;
    assert.ok(venueId);

    const servicePointResult = await pool.query<{ id: string }>(
      `
        INSERT INTO service_points (
          venue_id,
          code,
          name,
          slug,
          status,
          sort_order
        )
        VALUES ($1, $2, $3, $4, 'ACTIVE', 9999)
        RETURNING id
      `,
      [venueId, `VERIFY-${suffix}`, 'Sân xác minh dashboard', `verify-dashboard-${suffix}`],
    );
    servicePointId = servicePointResult.rows[0]?.id ?? null;
    assert.ok(servicePointId);

    const billResult = await pool.query<{ id: string }>(
      `
        INSERT INTO bills (
          venue_id,
          service_point_id,
          status,
          subtotal_vnd,
          total_vnd
        )
        VALUES ($1, $2, 'OPEN', 125000, 125000)
        RETURNING id
      `,
      [venueId, servicePointId],
    );
    const billId = billResult.rows[0]?.id;
    assert.ok(billId);

    await pool.query(
      `
        INSERT INTO orders (
          venue_id,
          service_point_id,
          bill_id,
          idempotency_key,
          status,
          total_vnd
        )
        VALUES
          ($1, $2, $3, $4, 'PENDING', 50000),
          ($1, $2, $3, $5, 'PENDING', 75000)
      `,
      [venueId, servicePointId, billId, randomUUID(), randomUUID()],
    );
    await pool.query(
      `
        INSERT INTO service_requests (
          venue_id,
          service_point_id,
          bill_id,
          status,
          message
        )
        VALUES ($1, $2, $3, 'PENDING', 'Step 5 verification')
      `,
      [venueId, servicePointId, billId],
    );

    const dashboard = await dashboardRepository.read();
    const verificationCourt = dashboard.servicePoints.find(
      (servicePoint) => servicePoint.id === servicePointId,
    );

    assert.ok(verificationCourt);
    assert.equal(verificationCourt.openBill?.totalVnd, 125_000);
    assert.equal(verificationCourt.pendingOrderCount, 2);
    assert.equal(verificationCourt.hasPendingServiceRequest, true);

    console.log('Admin authentication and dashboard database verification PASS.');
    console.log(
      JSON.stringify(
        {
          adminId,
          dashboardServicePointId: servicePointId,
          pendingOrderCount: verificationCourt.pendingOrderCount,
          sessionHashStored: true,
          username: seedEnvironment.ADMIN_SEED_USERNAME,
        },
        null,
        2,
      ),
    );
  } finally {
    if (servicePointId) {
      await pool.query(`DELETE FROM service_requests WHERE service_point_id = $1`, [
        servicePointId,
      ]);
      await pool.query(`DELETE FROM orders WHERE service_point_id = $1`, [servicePointId]);
      await pool.query(`DELETE FROM bills WHERE service_point_id = $1`, [servicePointId]);
      await pool.query(`DELETE FROM service_points WHERE id = $1`, [servicePointId]);
    }

    if (venueId) {
      await pool.query(`DELETE FROM venues WHERE id = $1`, [venueId]);
    }

    if (sessionHashes.length > 0) {
      await pool.query(`DELETE FROM admin_sessions WHERE token_hash = ANY($1::text[])`, [
        sessionHashes,
      ]);
    }

    if (adminId) {
      await pool.query(
        `UPDATE admin_users SET status = 'ACTIVE', updated_at = now() WHERE id = $1`,
        [adminId],
      );
    }

    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
