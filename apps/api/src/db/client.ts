import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: Pool;
}

export interface DatabaseConnectionOptions {
  applicationName?: string;
  maxConnections?: number;
}

export function createDatabaseConnection(
  databaseUrl: string,
  options: DatabaseConnectionOptions = {},
): DatabaseConnection {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.maxConnections ?? 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: options.applicationName ?? 'nhdp-api',
  });

  return {
    pool,
    db: drizzle(pool, { schema }),
  };
}
