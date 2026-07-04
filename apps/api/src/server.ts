import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { buildApp } from './app.js';
import { readApiEnvironment } from './config/environment.js';

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
    });
  }
}

const environment = readApiEnvironment();

const app = buildApp({
  logger: {
    level: environment.LOG_LEVEL,
  },
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
    host: environment.API_HOST,
    port: environment.API_PORT,
  });
} catch (error) {
  app.log.error({ error }, 'API failed to start');
  process.exitCode = 1;
  await app.close();
}
