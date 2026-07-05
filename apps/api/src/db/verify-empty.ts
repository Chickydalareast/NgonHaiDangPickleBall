import assert from 'node:assert/strict';

import { Client } from 'pg';

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

    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());
    await verifyDatabaseFoundation(verificationUrl.toString());

    const secondCounts = await readSeedCounts(verificationUrl.toString());

    assert.deepEqual(secondCounts, firstCounts, 'Migration and seed reruns must be idempotent.');

    console.log('Empty database migration + seed verification PASS.');
    console.log(JSON.stringify(secondCounts, null, 2));
  } finally {
    await adminClient.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(verificationDatabase)} WITH (FORCE)`,
    );
    await adminClient.end();
  }
}

void verifyEmptyDatabase().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
