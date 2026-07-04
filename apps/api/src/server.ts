import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { createAdminAuthService } from './admin/admin-auth-service.js';
import { createAdminDashboardRepository } from './admin/admin-dashboard-repository.js';
import { createAdminRealtimeHub } from './admin/admin-realtime-hub.js';
import { buildApp } from './app.js';
import { readDatabaseEnvironment } from './config/database-environment.js';
import { readApiEnvironment } from './config/environment.js';
import { createDatabaseConnection } from './db/client.js';
import { createOrderService } from './order/create-order-service.js';
import { createPublicContextRepository } from './public-context/public-context-repository.js';

if (process.env.NODE_ENV !== 'production') {
  const environmentCandidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];

  const localEnvironmentPath = environmentCandidates.find((candidate) => existsSync(candidate));

  if (localEnvironmentPath) {
    loadDotenv({
      path: localEnvironmentPath,
      override: false,
      quiet: true,
    });
  }
}

const apiEnvironment = readApiEnvironment();
const databaseEnvironment = readDatabaseEnvironment();
const database = createDatabaseConnection(databaseEnvironment.DATABASE_URL, {
  applicationName: 'nhdp-api',
  maxConnections: databaseEnvironment.DATABASE_POOL_MAX,
});
const adminAuthService = createAdminAuthService(database.pool, apiEnvironment.SESSION_SECRET);
const adminRealtimeHub = createAdminRealtimeHub();

const app = buildApp(
  {
    logger: {
      level: apiEnvironment.LOG_LEVEL,
    },
  },
  {
    adminAuthService,
    adminCookieSecure: new URL(apiEnvironment.WEB_ORIGIN).protocol === 'https:',
    adminDashboardRepository: createAdminDashboardRepository(database.pool),
    adminRealtimeHub,
    createOrderService: createOrderService(database.pool, adminRealtimeHub),
    publicContextRepository: createPublicContextRepository(database.db),
  },
);

app.addHook('onClose', async () => {
  adminRealtimeHub.close();
  await database.pool.end();
});

let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  app.log.info({ signal }, 'Graceful shutdown started');

  try {
    await app.close();
    app.log.info({ signal }, 'Graceful shutdown completed');
  } catch (error) {
    app.log.error({ error, signal }, 'Graceful shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({
    host: apiEnvironment.API_HOST,
    port: apiEnvironment.API_PORT,
  });
} catch (error) {
  app.log.error({ error }, 'API failed to start');
  process.exitCode = 1;
  await app.close();
}
