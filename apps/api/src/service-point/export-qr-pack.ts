import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { readApiEnvironment } from '../config/environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { createAdminServicePointService } from './admin-service-point-service.js';

async function main(): Promise<void> {
  const apiEnvironment = readApiEnvironment();
  const databaseEnvironment = readDatabaseEnvironment();
  const database = createDatabaseConnection(databaseEnvironment.DATABASE_URL, {
    applicationName: 'nhdp-service-point-qr-export',
    maxConnections: 2,
  });
  const outputDirectory = resolve(process.cwd(), 'artifacts/qr');
  const outputPath = resolve(outputDirectory, 'nhdp-service-points-qr-pack.zip');

  try {
    const service = createAdminServicePointService(database.pool, apiEnvironment.WEB_ORIGIN);
    const pack = await service.createActiveQrPack();
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, pack.zip);

    console.log('Service point QR pack export PASS.');
    console.log(
      JSON.stringify(
        {
          activeServicePoints: pack.manifest.servicePoints.length,
          outputPath,
          publicOrigin: pack.manifest.publicOrigin,
        },
        null,
        2,
      ),
    );
  } finally {
    await database.pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
