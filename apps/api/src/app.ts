import type { PublicServicePointContext } from '@nhdp/contracts';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { PublicContextRepository } from './public-context/public-context-repository.js';
import { registerPublicContextRoutes } from './public-context/public-context-routes.js';

const SERVICE_NAME = '@nhdp/api';
const SERVICE_VERSION = '0.0.0';

export interface HealthResponse {
  status: 'ok';
  service: typeof SERVICE_NAME;
  version: typeof SERVICE_VERSION;
  uptimeSeconds: number;
  timestamp: string;
}

export interface AppDependencies {
  publicContextRepository?: PublicContextRepository;
}

export function buildApp(
  options: FastifyServerOptions = {},
  dependencies: AppDependencies = {},
): FastifyInstance {
  const app = Fastify(options);

  app.get('/health', () => {
    const response: HealthResponse = {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return response;
  });

  if (dependencies.publicContextRepository) {
    registerPublicContextRoutes(app, {
      repository: dependencies.publicContextRepository,
    });
  }

  return app;
}

export type { PublicServicePointContext };
