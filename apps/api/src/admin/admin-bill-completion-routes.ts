import {
  adminBillCompletionApiErrorSchema,
  completeAdminBillResponseSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminBillCompletionDomainError,
  type AdminBillCompletionErrorCode,
  type AdminBillCompletionService,
} from './admin-bill-completion-service.js';

interface BillParams {
  billId?: string;
}

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const statusByErrorCode: Record<AdminBillCompletionErrorCode, number> = {
  ADMIN_BILL_NOT_FOUND: 404,
  ADMIN_BILL_NOT_OPEN: 409,
  BILL_HAS_UNRESOLVED_ORDERS: 409,
  BILL_HAS_OUTSTANDING_SETTLEMENTS: 409,
  BILL_TOTAL_TOO_LARGE: 422,
};

export interface AdminBillCompletionRouteOptions {
  service: AdminBillCompletionService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminBillCompletionApiErrorSchema.parse({
      code: 'INVALID_ADMIN_BILL_COMPLETION_REQUEST',
      message: 'Dữ liệu hoàn tất bill không hợp lệ.',
    }),
  );
}

export function registerAdminBillCompletionRoutes(
  app: FastifyInstance,
  options: AdminBillCompletionRouteOptions,
): void {
  app.post<{ Params: BillParams; Body: unknown }>(
    '/admin/bills/:billId/complete',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['billId'],
          properties: {
            billId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (
        request.validationError ||
        !request.params.billId ||
        (request.body !== undefined && request.body !== null)
      ) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      try {
        const result = await options.service.completeBill({
          adminUserId: request.adminSession.admin.id,
          billId: request.params.billId,
        });

        return completeAdminBillResponseSchema.parse(result);
      } catch (error) {
        if (error instanceof AdminBillCompletionDomainError) {
          return reply.code(statusByErrorCode[error.code]).send(
            adminBillCompletionApiErrorSchema.parse({
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
