import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { verify } from '@node-rs/argon2';
import type { PoolClient } from 'pg';

import { readDatabaseEnvironment, readSeedEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from './client.js';
import { withTransaction } from './transaction.js';

const requiredTables = [
  'activity_logs',
  'admin_sessions',
  'admin_users',
  'bills',
  'catalog_categories',
  'catalog_items',
  'order_lines',
  'orders',
  'service_points',
  'service_requests',
  'venues',
] as const;

const requiredIndexes = [
  'one_open_bill_per_service_point',
  'one_pending_service_request_per_service_point',
  'orders_idempotency_key_unique',
] as const;

export interface SeedCounts {
  admins: number;
  categories: number;
  items: number;
  servicePoints: number;
  venues: number;
}

interface PostgreSqlErrorLike {
  code: string | undefined;
  constraint: string | undefined;
  message: string | undefined;
}

function toPostgreSqlError(error: unknown): PostgreSqlErrorLike {
  if (typeof error !== 'object' || error === null) {
    return { code: undefined, constraint: undefined, message: undefined };
  }

  return {
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    constraint:
      'constraint' in error && typeof error.constraint === 'string' ? error.constraint : undefined,
    message: 'message' in error && typeof error.message === 'string' ? error.message : undefined,
  };
}

async function expectConstraintViolation(
  client: PoolClient,
  savepoint: string,
  queryText: string,
  values: readonly unknown[],
  expectedCode: string,
  expectedConstraint: string,
): Promise<void> {
  assert.match(savepoint, /^[a-z][a-z0-9_]*$/);
  await client.query(`SAVEPOINT ${savepoint}`);

  let receivedError: unknown;

  try {
    await client.query(queryText, [...values]);
  } catch (error) {
    receivedError = error;
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);

  assert.ok(receivedError, `Expected PostgreSQL constraint ${expectedConstraint}.`);

  const postgresError = toPostgreSqlError(receivedError);

  assert.equal(postgresError.code, expectedCode);
  assert.equal(postgresError.constraint, expectedConstraint);
}

export async function readSeedCounts(databaseUrl: string): Promise<SeedCounts> {
  const environment = readDatabaseEnvironment({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  const { pool } = createDatabaseConnection(databaseUrl, {
    applicationName: 'nhdp-seed-counts',
    maxConnections: environment.DATABASE_POOL_MAX,
  });

  try {
    const result = await pool.query<SeedCounts>(`
      SELECT
        (SELECT count(*)::int FROM admin_users) AS admins,
        (SELECT count(*)::int FROM catalog_categories) AS categories,
        (SELECT count(*)::int FROM catalog_items) AS items,
        (SELECT count(*)::int FROM service_points) AS "servicePoints",
        (SELECT count(*)::int FROM venues) AS venues
    `);

    const counts = result.rows[0];

    if (!counts) {
      throw new Error('Unable to read seed counts.');
    }

    return counts;
  } finally {
    await pool.end();
  }
}

export async function verifyDatabaseFoundation(
  databaseUrl = readDatabaseEnvironment().DATABASE_URL,
): Promise<SeedCounts> {
  const environment = readDatabaseEnvironment({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  const seedEnvironment = readSeedEnvironment({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  const { pool } = createDatabaseConnection(databaseUrl, {
    applicationName: 'nhdp-foundation-verifier',
    maxConnections: environment.DATABASE_POOL_MAX,
  });

  try {
    const tableResult = await pool.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const actualTables = new Set(tableResult.rows.map((row) => row.tablename));

    for (const table of requiredTables) {
      assert.ok(actualTables.has(table), `Missing required table: ${table}`);
    }

    const indexResult = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
    `);
    const actualIndexes = new Set(indexResult.rows.map((row) => row.indexname));

    for (const indexName of requiredIndexes) {
      assert.ok(actualIndexes.has(indexName), `Missing required index: ${indexName}`);
    }

    const uuidVersionResult = await pool.query<{ version: number }>(`
      SELECT DISTINCT uuid_extract_version(id)::int AS version
      FROM venues
    `);

    assert.deepEqual(uuidVersionResult.rows, [{ version: 7 }]);

    const adminResult = await pool.query<{ passwordHash: string }>(
      `
        SELECT password_hash AS "passwordHash"
        FROM admin_users
        WHERE email = $1
      `,
      [seedEnvironment.ADMIN_SEED_EMAIL],
    );
    const admin = adminResult.rows[0];

    assert.ok(admin, 'Seed admin is missing.');
    assert.ok(
      admin.passwordHash.startsWith('$argon2id$'),
      'Seed admin password hash is not Argon2id.',
    );
    assert.equal(
      await verify(admin.passwordHash, seedEnvironment.ADMIN_SEED_PASSWORD),
      true,
      'Seed admin password does not verify.',
    );

    const rollbackMarker = `verification.rollback.${randomUUID()}`;

    await assert.rejects(
      withTransaction(pool, async (client) => {
        await client.query(
          `
            INSERT INTO activity_logs (actor_type, action)
            VALUES ('SYSTEM', $1)
          `,
          [rollbackMarker],
        );

        throw new Error('EXPECTED_TRANSACTION_ROLLBACK');
      }),
      /EXPECTED_TRANSACTION_ROLLBACK/,
    );

    const rollbackResult = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM activity_logs WHERE action = $1`,
      [rollbackMarker],
    );

    assert.equal(rollbackResult.rows[0]?.count, 0);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const contextResult = await client.query<{
        catalogItemId: string;
        venueId: string;
      }>(`
        SELECT
          ci.id AS "catalogItemId",
          v.id AS "venueId"
        FROM venues v
        JOIN catalog_items ci ON ci.venue_id = v.id
        WHERE v.slug = 'ngon-hai-dang-pickleball'
        ORDER BY ci.sort_order, ci.created_at
        LIMIT 1
      `);
      const context = contextResult.rows[0];

      assert.ok(context, 'Seed venue/catalog item context is missing.');

      const verificationSuffix = randomUUID().replaceAll('-', '').slice(0, 16);
      const servicePointResult = await client.query<{ id: string }>(
        `
          INSERT INTO service_points (venue_id, code, name, slug)
          VALUES ($1, $2, 'Verification court', $3)
          RETURNING id
        `,
        [context.venueId, `VERIFY-${verificationSuffix}`, `verify-${verificationSuffix}`],
      );
      const servicePointId = servicePointResult.rows[0]?.id;

      assert.ok(servicePointId, 'Verification service point was not created.');

      const billResult = await client.query<{ id: string }>(
        `
          INSERT INTO bills (venue_id, service_point_id)
          VALUES ($1, $2)
          RETURNING id
        `,
        [context.venueId, servicePointId],
      );
      const billId = billResult.rows[0]?.id;

      assert.ok(billId, 'Verification bill was not created.');

      await expectConstraintViolation(
        client,
        'duplicate_open_bill',
        `INSERT INTO bills (venue_id, service_point_id) VALUES ($1, $2)`,
        [context.venueId, servicePointId],
        '23505',
        'one_open_bill_per_service_point',
      );

      const idempotencyKey = `verify-${randomUUID()}`;
      const orderResult = await client.query<{ id: string }>(
        `
          INSERT INTO orders (
            venue_id,
            service_point_id,
            bill_id,
            idempotency_key
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [context.venueId, servicePointId, billId, idempotencyKey],
      );
      const orderId = orderResult.rows[0]?.id;

      assert.ok(orderId, 'Verification order was not created.');

      await expectConstraintViolation(
        client,
        'duplicate_idempotency_key',
        `
          INSERT INTO orders (
            venue_id,
            service_point_id,
            bill_id,
            idempotency_key
          )
          VALUES ($1, $2, $3, $4)
        `,
        [context.venueId, servicePointId, billId, idempotencyKey],
        '23505',
        'orders_idempotency_key_unique',
      );

      await client.query(
        `
          INSERT INTO service_requests (venue_id, service_point_id, bill_id)
          VALUES ($1, $2, $3)
        `,
        [context.venueId, servicePointId, billId],
      );

      await expectConstraintViolation(
        client,
        'duplicate_pending_service_request',
        `
          INSERT INTO service_requests (venue_id, service_point_id, bill_id)
          VALUES ($1, $2, $3)
        `,
        [context.venueId, servicePointId, billId],
        '23505',
        'one_pending_service_request_per_service_point',
      );

      await expectConstraintViolation(
        client,
        'invalid_line_total',
        `
          INSERT INTO order_lines (
            order_id,
            bill_id,
            catalog_item_id,
            item_name_snapshot,
            unit_name_snapshot,
            unit_price_snapshot_vnd,
            quantity,
            line_total_vnd
          )
          VALUES ($1, $2, $3, 'Verification item', 'unit', 10000, 2, 19999)
        `,
        [orderId, billId, context.catalogItemId],
        '23514',
        'order_lines_total_formula_check',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  } finally {
    await pool.end();
  }

  const counts = await readSeedCounts(databaseUrl);

  assert.ok(counts.admins >= 1, 'Expected at least one admin user.');
  assert.ok(counts.categories >= 3, 'Expected seeded catalog categories.');
  assert.ok(counts.items >= 6, 'Expected seeded catalog items.');
  assert.ok(counts.servicePoints >= 1, 'Expected at least one service point.');
  assert.ok(counts.venues >= 1, 'Expected at least one venue.');

  return counts;
}
