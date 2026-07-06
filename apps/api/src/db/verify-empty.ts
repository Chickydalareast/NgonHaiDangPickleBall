import assert from 'node:assert/strict';

import { Client } from 'pg';

import { dropVerificationDatabase } from './verification-database.js';

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { runMigrations } from './migrations.js';
import { seedDatabase } from './seed-service.js';
import { readSeedCounts, verifyDatabaseFoundation } from './verify-service.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function verifyEmptyDatabase(): Promise<void> {
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const verificationDatabase = `nhdp_step2_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);

  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${verificationDatabase}`;

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-empty-database-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(verificationDatabase)}`);

    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());
    await verifyDatabaseFoundation(verificationUrl.toString());

    const firstCounts = await readSeedCounts(verificationUrl.toString());

    assert.deepEqual(firstCounts, {
      admins: 1,
      categories: 3,
      items: 6,
      servicePoints: 10,
      venues: 1,
    });

    const operationalClient = new Client({
      connectionString: verificationUrl.toString(),
      application_name: 'nhdp-seed-preservation-verifier',
    });

    await operationalClient.connect();

    try {
      await operationalClient.query(
        `UPDATE venues SET name = 'Operational venue name' WHERE slug = 'ngon-hai-dang-pickleball'`,
      );
      await operationalClient.query(
        `UPDATE catalog_items SET price_vnd = 12345, is_available = false WHERE slug = 'nuoc-suoi-500ml'`,
      );

      await runMigrations(verificationUrl.toString());
      await seedDatabase(verificationUrl.toString());
      await verifyDatabaseFoundation(verificationUrl.toString());

      const preserved = await operationalClient.query<{
        venueName: string;
        priceVnd: number;
        isAvailable: boolean;
      }>(`
        SELECT
          venues.name AS "venueName",
          catalog_items.price_vnd AS "priceVnd",
          catalog_items.is_available AS "isAvailable"
        FROM venues
        JOIN catalog_items ON catalog_items.venue_id = venues.id
        WHERE venues.slug = 'ngon-hai-dang-pickleball'
          AND catalog_items.slug = 'nuoc-suoi-500ml'
      `);

      assert.deepEqual(preserved.rows[0], {
        venueName: 'Operational venue name',
        priceVnd: 12345,
        isAvailable: false,
      });
    } finally {
      await operationalClient.end();
    }

    const secondCounts = await readSeedCounts(verificationUrl.toString());

    assert.deepEqual(secondCounts, firstCounts, 'Migration and seed reruns must be idempotent.');

    console.log('Empty database migration + seed verification PASS.');
    console.log(JSON.stringify(secondCounts, null, 2));
  } finally {
    await dropVerificationDatabase(adminClient, verificationDatabase);
    await adminClient.end();
  }
}

void verifyEmptyDatabase().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
