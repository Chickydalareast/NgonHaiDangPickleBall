import type { Server as HttpServer } from 'node:http';

import type { PublicServicePointContext } from '@nhdp/contracts';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerCreateOrderRoutes } from './order/create-order-routes.js';
import type { CreateOrderService } from './order/create-order-service.js';
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
  createOrderService?: CreateOrderService;
  publicContextRepository?: PublicContextRepository;
}

type AppServerOptions = Omit<FastifyServerOptions<HttpServer>, 'ajv'>;

export function buildApp(
  options: AppServerOptions = {},
  dependencies: AppDependencies = {},
): FastifyInstance {
  const fastifyOptions: FastifyServerOptions<HttpServer> = {
    ...options,
    ajv: {
      customOptions: {
        // Không âm thầm xóa field lạ khỏi request tài chính.
        // additionalProperties: false phải trả validation error.
        removeAdditional: false,
      },
    },
  };

  const app = Fastify<HttpServer>(fastifyOptions);

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

  if (dependencies.createOrderService) {
    registerCreateOrderRoutes(app, {
      service: dependencies.createOrderService,
    });
  }

  return app;
}

export type { PublicServicePointContext };
