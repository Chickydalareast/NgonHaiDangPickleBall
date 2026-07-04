import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(
  databaseUrl = readDatabaseEnvironment().DATABASE_URL,
): Promise<void> {
  const environment = readDatabaseEnvironment({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  const { db, pool } = createDatabaseConnection(databaseUrl, {
    applicationName: 'nhdp-migrations',
    maxConnections: environment.DATABASE_POOL_MAX,
  });

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
