import type { Server as HttpServer } from 'node:http';

import type { PublicServicePointContext } from '@nhdp/contracts';
import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createRequireAdmin } from './admin/admin-auth-guard.js';
import { registerAdminBillCompletionRoutes } from './admin/admin-bill-completion-routes.js';
import type { AdminBillCompletionService } from './admin/admin-bill-completion-service.js';
import { registerAdminAuthRoutes } from './admin/admin-auth-routes.js';
import type { AdminAuthService } from './admin/admin-auth-service.js';
import type { AdminDashboardRepository } from './admin/admin-dashboard-repository.js';
import { registerAdminOrderOperationsRoutes } from './admin/admin-order-operations-routes.js';
import type { AdminOrderOperationsService } from './admin/admin-order-operations-service.js';
import { registerAdminDashboardRoutes } from './admin/admin-dashboard-routes.js';
import type { AdminRealtimeHub } from './admin/admin-realtime-hub.js';
import { registerAdminRealtimeRoutes } from './admin/admin-realtime-routes.js';
import { registerAdminServiceRequestRoutes } from './admin/admin-service-request-routes.js';
import type { AdminServiceRequestService } from './admin/admin-service-request-service.js';
import { registerCreateOrderRoutes } from './order/create-order-routes.js';
import type { CreateOrderService } from './order/create-order-service.js';
import type { PublicContextRepository } from './public-context/public-context-repository.js';
import { registerPublicContextRoutes } from './public-context/public-context-routes.js';
import { registerPublicServiceRequestRoutes } from './service-request/public-service-request-routes.js';
import type { PublicServiceRequestService } from './service-request/public-service-request-service.js';

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
  adminAuthService?: AdminAuthService;
  adminBillCompletionService?: AdminBillCompletionService;
  adminCookieSecure?: boolean;
  adminDashboardRepository?: AdminDashboardRepository;
  adminOrderOperationsService?: AdminOrderOperationsService;
  adminRealtimeHub?: AdminRealtimeHub;
  adminServiceRequestService?: AdminServiceRequestService;
  createOrderService?: CreateOrderService;
  publicContextRepository?: PublicContextRepository;
  publicServiceRequestService?: PublicServiceRequestService;
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
        // Không âm thầm xóa field lạ khỏi request tài chính hoặc auth.
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

  if (dependencies.publicServiceRequestService) {
    registerPublicServiceRequestRoutes(app, {
      service: dependencies.publicServiceRequestService,
    });
  }

  if (dependencies.createOrderService) {
    registerCreateOrderRoutes(app, {
      service: dependencies.createOrderService,
    });
  }

  if (
    (dependencies.adminBillCompletionService ||
      dependencies.adminDashboardRepository ||
      dependencies.adminOrderOperationsService ||
      dependencies.adminRealtimeHub ||
      dependencies.adminServiceRequestService) &&
    !dependencies.adminAuthService
  ) {
    throw new Error('Admin routes require the admin auth service.');
  }

  if (dependencies.adminAuthService) {
    void app.register(fastifyCookie);
    app.decorateRequest('adminSession', null);
    app.decorateRequest('adminSessionToken', null);

    const requireAdmin = createRequireAdmin(dependencies.adminAuthService);

    registerAdminAuthRoutes(app, {
      service: dependencies.adminAuthService,
      requireAdmin,
      secureCookie: dependencies.adminCookieSecure ?? false,
    });

    if (dependencies.adminBillCompletionService) {
      registerAdminBillCompletionRoutes(app, {
        service: dependencies.adminBillCompletionService,
        requireAdmin,
      });
    }

    if (dependencies.adminDashboardRepository) {
      registerAdminDashboardRoutes(app, {
        repository: dependencies.adminDashboardRepository,
        requireAdmin,
      });
    }

    if (dependencies.adminOrderOperationsService) {
      registerAdminOrderOperationsRoutes(app, {
        service: dependencies.adminOrderOperationsService,
        requireAdmin,
      });
    }

    if (dependencies.adminServiceRequestService) {
      registerAdminServiceRequestRoutes(app, {
        service: dependencies.adminServiceRequestService,
        requireAdmin,
      });
    }

    if (dependencies.adminRealtimeHub) {
      registerAdminRealtimeRoutes(app, {
        hub: dependencies.adminRealtimeHub,
        requireAdmin,
      });
    }
  }

  return app;
}

export type { PublicServicePointContext };
