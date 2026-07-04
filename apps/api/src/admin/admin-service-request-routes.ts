import {
  resolveAdminServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminServiceRequestDomainError,
  type AdminServiceRequestErrorCode,
  type AdminServiceRequestService,
} from './admin-service-request-service.js';

interface ServiceRequestParams {
  requestId?: string;
}

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const statusByErrorCode: Record<AdminServiceRequestErrorCode, number> = {
  ADMIN_SERVICE_REQUEST_NOT_FOUND: 404,
  ADMIN_SERVICE_REQUEST_NOT_PENDING: 409,
};

export interface AdminServiceRequestRouteOptions {
  service: AdminServiceRequestService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    serviceRequestApiErrorSchema.parse({
      code: 'INVALID_ADMIN_SERVICE_REQUEST',
      message: 'Dữ liệu xử lý yêu cầu hỗ trợ không hợp lệ.',
    }),
  );
}

export function registerAdminServiceRequestRoutes(
  app: FastifyInstance,
  options: AdminServiceRequestRouteOptions,
): void {
  app.patch<{ Params: ServiceRequestParams; Body: unknown }>(
    '/admin/service-requests/:requestId/resolve',
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
        const result = await options.service.resolve({
          adminUserId: request.adminSession.admin.id,
          serviceRequestId: request.params.requestId,
        });

        return resolveAdminServiceRequestResponseSchema.parse(result);
      } catch (error) {
        if (error instanceof AdminServiceRequestDomainError) {
          return reply.code(statusByErrorCode[error.code]).send(
            serviceRequestApiErrorSchema.parse({
              code: error.code,
              message: error.message,
            }),
          );
        }

        throw error;
      }
    },
  );
}
