import {
  acknowledgeAdminAlertResponseSchema,
  adminAlertApiErrorSchema,
  adminAlertsResponseSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminAlertDomainError,
  type AdminAlertErrorCode,
  type AdminAlertService,
} from './admin-alert-service.js';

interface OrderAlertParams {
  orderId?: string;
}

interface ServiceRequestAlertParams {
  requestId?: string;
}

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const statusByErrorCode: Record<AdminAlertErrorCode, number> = {
  ADMIN_ALERT_NOT_FOUND: 404,
  ADMIN_ALERT_NOT_ACTIVE: 409,
};

export interface AdminAlertRouteOptions {
  service: AdminAlertService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminAlertApiErrorSchema.parse({
      code: 'INVALID_ADMIN_ALERT_REQUEST',
      message: 'Dữ liệu xác nhận cảnh báo không hợp lệ.',
    }),
  );
}

function sendDomainError(error: AdminAlertDomainError, reply: FastifyReply): FastifyReply {
  return reply.code(statusByErrorCode[error.code]).send(
    adminAlertApiErrorSchema.parse({
      code: error.code,
      message: error.message,
    }),
  );
}

export function registerAdminAlertRoutes(
  app: FastifyInstance,
  options: AdminAlertRouteOptions,
): void {
  app.get(
    '/admin/alerts',
    {
      preHandler: options.requireAdmin,
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return adminAlertsResponseSchema.parse(await options.service.read());
    },
  );

  app.patch<{ Params: OrderAlertParams; Body: unknown }>(
    '/admin/alerts/orders/:orderId/acknowledge',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['orderId'],
          properties: {
            orderId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (
        request.validationError ||
        !request.params.orderId ||
        (request.body !== undefined && request.body !== null)
      ) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      try {
        return acknowledgeAdminAlertResponseSchema.parse(
          await options.service.acknowledgeOrder({
            adminUserId: request.adminSession.admin.id,
            orderId: request.params.orderId,
          }),
        );
      } catch (error) {
        if (error instanceof AdminAlertDomainError) {
          return sendDomainError(error, reply);
        }

        throw error;
      }
    },
  );

  app.patch<{ Params: ServiceRequestAlertParams; Body: unknown }>(
    '/admin/alerts/service-requests/:requestId/acknowledge',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['requestId'],
          properties: {
            requestId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (
        request.validationError ||
        !request.params.requestId ||
        (request.body !== undefined && request.body !== null)
      ) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      try {
        return acknowledgeAdminAlertResponseSchema.parse(
          await options.service.acknowledgeServiceRequest({
            adminUserId: request.adminSession.admin.id,
            serviceRequestId: request.params.requestId,
          }),
        );
      } catch (error) {
        if (error instanceof AdminAlertDomainError) {
          return sendDomainError(error, reply);
        }

        throw error;
      }
    },
  );
}
