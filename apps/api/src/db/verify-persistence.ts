import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { Client } from 'pg';

import { readDatabaseEnvironment } from '../config/database-environment.js';

interface VenueMarker {
  id: string;
  name: string;
}

async function readVenueMarker(databaseUrl: string): Promise<VenueMarker> {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'nhdp-persistence-verifier',
    connectionTimeoutMillis: 3_000,
  });

  await client.connect();

  try {
    const result = await client.query<VenueMarker>(`
      SELECT id, name
      FROM venues
      WHERE slug = 'ngon-hai-dang-pickleball'
    `);
    const marker = result.rows[0];

    if (!marker) {
      throw new Error('Seed venue marker is missing before persistence check.');
    }

    return marker;
  } finally {
    await client.end();
  }
}

async function waitForVenueMarker(databaseUrl: string, timeoutMs = 90_000): Promise<VenueMarker> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await readVenueMarker(databaseUrl);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
    }
  }

  throw new Error(
    `PostgreSQL did not become ready after restart.${
      lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
    }`,
  );
}

async function verifyPersistence(): Promise<void> {
  const { DATABASE_URL } = readDatabaseEnvironment();
  const before = await readVenueMarker(DATABASE_URL);

  execFileSync('docker', ['compose', 'restart', 'postgres'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true,
  });

  const after = await waitForVenueMarker(DATABASE_URL);

  assert.deepEqual(after, before, 'Seed venue changed or disappeared after restart.');

  console.log('PostgreSQL persistence verification PASS.');
  console.log(`Venue persisted: ${after.name} (${after.id})`);
}

void verifyPersistence().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
