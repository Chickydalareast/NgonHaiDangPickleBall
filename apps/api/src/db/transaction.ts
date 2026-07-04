import type { Pool, PoolClient } from 'pg';

export type TransactionIsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  readOnly?: boolean;
}

const isolationStatements: Record<TransactionIsolationLevel, string> = {
  'read committed': 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
  'repeatable read': 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
  serializable: 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
};

export async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (options.isolationLevel) {
      await client.query(isolationStatements[options.isolationLevel]);
    }

    if (options.readOnly) {
      await client.query('SET TRANSACTION READ ONLY');
    }

    const result = await operation(client);
    await client.query('COMMIT');

    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original application/database error.
    }

    throw error;
  } finally {
    client.release();
  }
}
