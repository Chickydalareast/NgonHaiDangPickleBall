import type { Server as HttpServer } from 'node:http';

import type { PublicServicePointContext } from '@nhdp/contracts';
import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createRequireAdmin } from './admin/admin-auth-guard.js';
import { registerAdminAlertRoutes } from './admin/admin-alert-routes.js';
import type { AdminAlertService } from './admin/admin-alert-service.js';
import { registerAdminCheckoutRoutes } from './checkout/admin-checkout-routes.js';
import type { AdminCheckoutService } from './checkout/admin-checkout-service.js';
import { registerAdminCatalogRoutes } from './catalog/admin-catalog-routes.js';
import { registerAdminCustomChargeRoutes } from './custom-charge/admin-custom-charge-routes.js';
import type { AdminCustomChargeService } from './custom-charge/admin-custom-charge-service.js';
import type { AdminCatalogService } from './catalog/admin-catalog-service.js';
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
import { registerAdminServicePointRoutes } from './service-point/admin-service-point-routes.js';
import { registerAdminSettlementRoutes } from './settlement/admin-settlement-routes.js';
import type { AdminSettlementService } from './settlement/admin-settlement-service.js';
import type { AdminServicePointService } from './service-point/admin-service-point-service.js';
import { registerCreateOrderRoutes } from './order/create-order-routes.js';
import type { CreateOrderService } from './order/create-order-service.js';
import type { PublicContextRepository } from './public-context/public-context-repository.js';
import { registerPublicCurrentBillRoutes } from './public-bill/public-current-bill-routes.js';
import type { PublicCurrentBillService } from './public-bill/public-current-bill-service.js';
import { registerPublicContextRoutes } from './public-context/public-context-routes.js';
import { registerPublicServiceRequestRoutes } from './service-request/public-service-request-routes.js';
import type { PublicServiceRequestService } from './service-request/public-service-request-service.js';

const SERVICE_NAME = '@nhdp/api';
const SERVICE_VERSION = '0.0.0';
const DEFAULT_COMMIT_SHA = 'unknown';

function registerEmptyActionContentTypeCompatibility(app: FastifyInstance): void {
  app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 64 }, (_request, body, done) => {
    const normalizedBody = String(body).trim();
    done(null, normalizedBody === '' || normalizedBody === 'null' ? null : body);
  });
}

export interface HealthResponse {
  status: 'ok';
  service: typeof SERVICE_NAME;
  version: typeof SERVICE_VERSION;
  uptimeSeconds: number;
  timestamp: string;
  commitSha: string;
}

export interface ReadyResponse {
  status: 'ready';
  service: typeof SERVICE_NAME;
  version: typeof SERVICE_VERSION;
  timestamp: string;
  commitSha: string;
}

export interface NotReadyResponse {
  status: 'not_ready';
  service: typeof SERVICE_NAME;
  version: typeof SERVICE_VERSION;
  timestamp: string;
  commitSha: string;
}

export interface AppDependencies {
  adminAlertService?: AdminAlertService;
  adminAuthService?: AdminAuthService;
  adminCatalogService?: AdminCatalogService;
  adminCheckoutService?: AdminCheckoutService;
  adminCustomChargeService?: AdminCustomChargeService;
  adminBillCompletionService?: AdminBillCompletionService;
  adminCookieSecure?: boolean;
  adminDashboardRepository?: AdminDashboardRepository;
  adminOrderOperationsService?: AdminOrderOperationsService;
  adminRealtimeHub?: AdminRealtimeHub;
  adminServiceRequestService?: AdminServiceRequestService;
  adminServicePointService?: AdminServicePointService;
  adminSettlementService?: AdminSettlementService;
  createOrderService?: CreateOrderService;
  publicContextRepository?: PublicContextRepository;
  publicCurrentBillService?: PublicCurrentBillService;
  publicServiceRequestService?: PublicServiceRequestService;
  readinessCheck?: () => Promise<void>;
  commitSha?: string;
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
  const commitSha = dependencies.commitSha ?? DEFAULT_COMMIT_SHA;

  app.get('/health', () => {
    const response: HealthResponse = {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      commitSha,
    };

    return response;
  });

  app.get('/ready', async (_request, reply) => {
    const responseBase = {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      commitSha,
    } as const;

    if (!dependencies.readinessCheck) {
      const response: NotReadyResponse = {
        status: 'not_ready',
        ...responseBase,
      };

      return reply.status(503).send(response);
    }

    try {
      await dependencies.readinessCheck();

      const response: ReadyResponse = {
        status: 'ready',
        ...responseBase,
      };

      return response;
    } catch (error) {
      app.log.warn({ error }, 'Readiness check failed');

      const response: NotReadyResponse = {
        status: 'not_ready',
        ...responseBase,
      };

      return reply.status(503).send(response);
    }
  });

  if (dependencies.publicContextRepository) {
    registerPublicContextRoutes(app, {
      repository: dependencies.publicContextRepository,
    });
  }

  if (dependencies.publicCurrentBillService) {
    registerPublicCurrentBillRoutes(app, {
      service: dependencies.publicCurrentBillService,
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
    (dependencies.adminAlertService ||
      dependencies.adminBillCompletionService ||
      dependencies.adminCatalogService ||
      dependencies.adminCheckoutService ||
      dependencies.adminCustomChargeService ||
      dependencies.adminDashboardRepository ||
      dependencies.adminOrderOperationsService ||
      dependencies.adminRealtimeHub ||
      dependencies.adminServicePointService ||
      dependencies.adminSettlementService ||
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

    const adminAlertService = dependencies.adminAlertService;
    if (adminAlertService) {
      void app.register((alertApp) => {
        registerEmptyActionContentTypeCompatibility(alertApp);
        registerAdminAlertRoutes(alertApp, {
          service: adminAlertService,
          requireAdmin,
        });

        return Promise.resolve();
      });
    }

    if (dependencies.adminBillCompletionService) {
      registerAdminBillCompletionRoutes(app, {
        service: dependencies.adminBillCompletionService,
        requireAdmin,
      });
    }

    if (dependencies.adminCatalogService) {
      registerAdminCatalogRoutes(app, {
        service: dependencies.adminCatalogService,
        requireAdmin,
      });
    }

    if (dependencies.adminCheckoutService) {
      registerAdminCheckoutRoutes(app, {
        service: dependencies.adminCheckoutService,
        requireAdmin,
      });
    }

    if (dependencies.adminCustomChargeService) {
      registerAdminCustomChargeRoutes(app, {
        service: dependencies.adminCustomChargeService,
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

    if (dependencies.adminServicePointService) {
      registerAdminServicePointRoutes(app, {
        service: dependencies.adminServicePointService,
        requireAdmin,
      });
    }

    if (dependencies.adminSettlementService) {
      registerAdminSettlementRoutes(app, {
        service: dependencies.adminSettlementService,
        requireAdmin,
      });
    }

    const adminServiceRequestService = dependencies.adminServiceRequestService;
    if (adminServiceRequestService) {
      void app.register((serviceRequestApp) => {
        registerEmptyActionContentTypeCompatibility(serviceRequestApp);
        registerAdminServiceRequestRoutes(serviceRequestApp, {
          service: adminServiceRequestService,
          requireAdmin,
        });

        return Promise.resolve();
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
