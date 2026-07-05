import {
  adminBillDetailResponseSchema,
  adminSettlementApiErrorSchema,
  createAdminSettlementRequestSchema,
  reverseAdminSettlementRequestSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminSettlementDomainError,
  type AdminSettlementErrorCode,
  type AdminSettlementService,
} from './admin-settlement-service.js';

interface LineParams {
  lineId?: string;
}

interface SettlementParams {
  settlementId?: string;
}

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const statusByErrorCode: Record<AdminSettlementErrorCode, number> = {
  ADMIN_ORDER_LINE_NOT_FOUND: 404,
  ADMIN_SETTLEMENT_NOT_FOUND: 404,
  ADMIN_BILL_NOT_OPEN: 409,
  ORDER_LINE_NOT_SETTLEABLE: 409,
  SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING: 409,
  SETTLEMENT_IDEMPOTENCY_CONFLICT: 409,
  SETTLEMENT_ALREADY_REVERSED: 409,
  SETTLEMENT_REVERSAL_IDEMPOTENCY_CONFLICT: 409,
  SETTLEMENT_TOTAL_TOO_LARGE: 422,
};

export interface AdminSettlementRouteOptions {
  service: AdminSettlementService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminSettlementApiErrorSchema.parse({
      code: 'INVALID_ADMIN_SETTLEMENT_REQUEST',
      message: 'Dữ liệu settlement không hợp lệ.',
    }),
  );
}

function sendDomainError(reply: FastifyReply, error: AdminSettlementDomainError): FastifyReply {
  return reply.code(statusByErrorCode[error.code]).send(
    adminSettlementApiErrorSchema.parse({
      code: error.code,
      message: error.message,
    }),
  );
}

export function registerAdminSettlementRoutes(
  app: FastifyInstance,
  options: AdminSettlementRouteOptions,
): void {
  app.post<{ Params: LineParams; Body: unknown }>(
    '/admin/order-lines/:lineId/settlements',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['lineId'],
          properties: {
            lineId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = createAdminSettlementRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.lineId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      try {
        const result = await options.service.create({
          adminUserId: request.adminSession.admin.id,
          lineId: request.params.lineId,
          request: parsed.data,
        });

        return adminBillDetailResponseSchema.parse(result);
      } catch (error) {
        if (error instanceof AdminSettlementDomainError) {
          return sendDomainError(reply, error);
        }

        throw error;
      }
    },
  );

  app.post<{ Params: SettlementParams; Body: unknown }>(
    '/admin/settlements/:settlementId/reverse',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['settlementId'],
          properties: {
            settlementId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = reverseAdminSettlementRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.settlementId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      try {
        const result = await options.service.reverse({
          adminUserId: request.adminSession.admin.id,
          settlementId: request.params.settlementId,
          request: parsed.data,
        });

        return adminBillDetailResponseSchema.parse(result);
      } catch (error) {
        if (error instanceof AdminSettlementDomainError) {
          return sendDomainError(reply, error);
        }

        throw error;
      }
    },
  );
}
