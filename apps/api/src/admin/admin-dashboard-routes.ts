import { adminDashboardResponseSchema } from '@nhdp/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import type { AdminDashboardRepository } from './admin-dashboard-repository.js';

export interface AdminDashboardRouteOptions {
  repository: AdminDashboardRepository;
  requireAdmin: preHandlerAsyncHookHandler;
}

export function registerAdminDashboardRoutes(
  app: FastifyInstance,
  options: AdminDashboardRouteOptions,
): void {
  app.get('/admin/dashboard', { preHandler: options.requireAdmin }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const dashboard = await options.repository.read();

    return adminDashboardResponseSchema.parse(dashboard);
  });
}
