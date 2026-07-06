import assert from 'node:assert/strict';

import type { Client } from 'pg';

const databaseInUseErrorCode = '55006';
const verificationDatabaseDropTimeoutMs = 10_000;
const verificationDatabaseDropRetryMs = 100;

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export async function dropVerificationDatabase(
  adminClient: Client,
  databaseName: string,
): Promise<void> {
  const quotedDatabaseName = quoteIdentifier(databaseName);
  const deadline = Date.now() + verificationDatabaseDropTimeoutMs;
  let lastConnectionCount = 0;

  while (true) {
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
      return;
    } catch (error: unknown) {
      const postgresError = error as { code?: string };

      if (postgresError.code !== databaseInUseErrorCode) {
        throw error;
      }

      const connectionResult = await adminClient.query<{ connection_count: number }>(
        `
          SELECT COUNT(*)::int AS connection_count
          FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()
        `,
        [databaseName],
      );
      lastConnectionCount = connectionResult.rows[0]?.connection_count ?? 0;

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting to drop verification database ${databaseName}; ` +
            `${lastConnectionCount} connection(s) remain.`,
          { cause: error },
        );
      }

      await sleep(verificationDatabaseDropRetryMs);
    }
  }
}
