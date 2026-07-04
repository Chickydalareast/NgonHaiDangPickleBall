import {
  addAdminBillItemRequestSchema,
  adminBillDetailResponseSchema,
  adminOrderOperationApiErrorSchema,
  updateAdminOrderLineRequestSchema,
  updateAdminOrderStatusRequestSchema,
  voidAdminOrderLineRequestSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminOrderOperationDomainError,
  type AdminOrderOperationErrorCode,
  type AdminOrderOperationsService,
} from './admin-order-operations-service.js';

interface IdentifierParams {
  billId?: string;
  orderId?: string;
  lineId?: string;
}

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

function identifierParamsSchema(property: 'billId' | 'orderId' | 'lineId') {
  return {
    type: 'object',
    additionalProperties: false,
    required: [property],
    properties: {
      [property]: {
        type: 'string',
        pattern: identifierPattern,
      },
    },
  } as const;
}

const updateOrderStatusBodySchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { const: 'ACCEPTED' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { const: 'SERVED' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason'],
      properties: {
        status: { const: 'CANCELLED' },
        reason: { type: 'string', minLength: 3, maxLength: 300 },
      },
    },
  ],
} as const;

const addBillItemBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['catalogItemId', 'quantity'],
  properties: {
    catalogItemId: { type: 'string', pattern: identifierPattern },
    quantity: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const updateLineBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['quantity'],
  properties: {
    quantity: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const voidLineBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: {
    reason: { type: 'string', minLength: 3, maxLength: 300 },
  },
} as const;

const statusByErrorCode: Record<AdminOrderOperationErrorCode, number> = {
  ADMIN_BILL_NOT_FOUND: 404,
  ADMIN_ORDER_NOT_FOUND: 404,
  ADMIN_ORDER_LINE_NOT_FOUND: 404,
  ADMIN_CATALOG_ITEM_UNAVAILABLE: 409,
  ADMIN_BILL_NOT_OPEN: 409,
  INVALID_ORDER_TRANSITION: 409,
  ORDER_LINE_NOT_EDITABLE: 409,
  ORDER_LINE_ALREADY_VOIDED: 409,
  ORDER_TOTAL_TOO_LARGE: 422,
};

export interface AdminOrderOperationsRouteOptions {
  service: AdminOrderOperationsService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminOrderOperationApiErrorSchema.parse({
      code: 'INVALID_ADMIN_OPERATION_REQUEST',
      message: 'Dữ liệu thao tác order không hợp lệ.',
    }),
  );
}

async function executeDomain<T>(
  reply: FastifyReply,
  operation: () => Promise<T>,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AdminOrderOperationDomainError) {
      reply.code(statusByErrorCode[error.code]).send(
        adminOrderOperationApiErrorSchema.parse({
          code: error.code,
          message: error.message,
        }),
      );
      return null;
    }

    throw error;
  }
}

export function registerAdminOrderOperationsRoutes(
  app: FastifyInstance,
  options: AdminOrderOperationsRouteOptions,
): void {
  app.get<{ Params: IdentifierParams }>(
    '/admin/bills/:billId',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: { params: identifierParamsSchema('billId') },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (request.validationError || !request.params.billId) {
        return sendInvalidRequest(reply);
      }

      const bill = await options.service.readBill(request.params.billId);

      if (!bill) {
        return reply.code(404).send(
          adminOrderOperationApiErrorSchema.parse({
            code: 'ADMIN_BILL_NOT_FOUND',
            message: 'Không tìm thấy bill.',
          }),
        );
      }

      return adminBillDetailResponseSchema.parse(bill);
    },
  );

  app.post<{ Params: IdentifierParams; Body: unknown }>(
    '/admin/bills/:billId/items',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: identifierParamsSchema('billId'),
        body: addBillItemBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = addAdminBillItemRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.billId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      const result = await executeDomain(reply, () =>
        options.service.addBillItem({
          adminUserId: request.adminSession!.admin.id,
          billId: request.params.billId!,
          request: parsed.data,
        }),
      );

      return result ? adminBillDetailResponseSchema.parse(result) : reply;
    },
  );

  app.patch<{ Params: IdentifierParams; Body: unknown }>(
    '/admin/orders/:orderId/status',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: identifierParamsSchema('orderId'),
        body: updateOrderStatusBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = updateAdminOrderStatusRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.orderId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      const result = await executeDomain(reply, () =>
        options.service.updateOrderStatus({
          adminUserId: request.adminSession!.admin.id,
          orderId: request.params.orderId!,
          request: parsed.data,
        }),
      );

      return result ? adminBillDetailResponseSchema.parse(result) : reply;
    },
  );

  app.patch<{ Params: IdentifierParams; Body: unknown }>(
    '/admin/order-lines/:lineId',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: identifierParamsSchema('lineId'),
        body: updateLineBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = updateAdminOrderLineRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.lineId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      const result = await executeDomain(reply, () =>
        options.service.updateOrderLine({
          adminUserId: request.adminSession!.admin.id,
          lineId: request.params.lineId!,
          request: parsed.data,
        }),
      );

      return result ? adminBillDetailResponseSchema.parse(result) : reply;
    },
  );

  app.post<{ Params: IdentifierParams; Body: unknown }>(
    '/admin/order-lines/:lineId/void',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: identifierParamsSchema('lineId'),
        body: voidLineBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = voidAdminOrderLineRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.lineId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      const result = await executeDomain(reply, () =>
        options.service.voidOrderLine({
          adminUserId: request.adminSession!.admin.id,
          lineId: request.params.lineId!,
          request: parsed.data,
        }),
      );

      return result ? adminBillDetailResponseSchema.parse(result) : reply;
    },
  );
}
