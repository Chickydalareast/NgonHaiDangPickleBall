import {
  adminBillDetailResponseSchema,
  adminCustomChargeApiErrorSchema,
  createAdminCustomChargeRequestSchema,
  updateAdminCustomChargeRequestSchema,
  voidAdminCustomChargeRequestSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminCustomChargeDomainError,
  type AdminCustomChargeErrorCode,
  type AdminCustomChargeService,
} from './admin-custom-charge-service.js';

interface IdentifierParams {
  billId?: string;
  chargeId?: string;
}

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

function identifierParamsSchema(property: 'billId' | 'chargeId') {
  return {
    type: 'object',
    additionalProperties: false,
    required: [property],
    properties: {
      [property]: { type: 'string', pattern: identifierPattern },
    },
  } as const;
}

const createBodySchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'idempotencyKey', 'name', 'unitName', 'quantity', 'unitPriceVnd'],
      properties: {
        kind: { const: 'MANUAL_PRODUCT' },
        idempotencyKey: { type: 'string', pattern: identifierPattern },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        unitName: { type: 'string', minLength: 1, maxLength: 40 },
        quantity: { type: 'integer', minimum: 1, maximum: 999 },
        unitPriceVnd: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'kind',
        'idempotencyKey',
        'name',
        'durationMinutes',
        'billingIntervalMinutes',
        'pricePerIntervalVnd',
      ],
      properties: {
        kind: { const: 'MANUAL_TIME' },
        idempotencyKey: { type: 'string', pattern: identifierPattern },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        durationMinutes: { type: 'integer', minimum: 1, maximum: 1_440 },
        billingIntervalMinutes: { type: 'integer', minimum: 1, maximum: 1_440 },
        pricePerIntervalVnd: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
      },
    },
  ],
} as const;

const updateBodySchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'name', 'unitName', 'quantity', 'unitPriceVnd'],
      properties: {
        kind: { const: 'MANUAL_PRODUCT' },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        unitName: { type: 'string', minLength: 1, maxLength: 40 },
        quantity: { type: 'integer', minimum: 1, maximum: 999 },
        unitPriceVnd: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'kind',
        'name',
        'durationMinutes',
        'billingIntervalMinutes',
        'pricePerIntervalVnd',
      ],
      properties: {
        kind: { const: 'MANUAL_TIME' },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        durationMinutes: { type: 'integer', minimum: 1, maximum: 1_440 },
        billingIntervalMinutes: { type: 'integer', minimum: 1, maximum: 1_440 },
        pricePerIntervalVnd: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
      },
    },
  ],
} as const;

const voidBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: {
    reason: { type: 'string', minLength: 3, maxLength: 300 },
  },
} as const;

const statusByErrorCode: Record<AdminCustomChargeErrorCode, number> = {
  ADMIN_BILL_NOT_FOUND: 404,
  ADMIN_BILL_NOT_OPEN: 409,
  ADMIN_CUSTOM_CHARGE_NOT_FOUND: 404,
  CUSTOM_CHARGE_KIND_IMMUTABLE: 409,
  CUSTOM_CHARGE_IDEMPOTENCY_CONFLICT: 409,
  CUSTOM_CHARGE_NOT_EDITABLE: 409,
  CUSTOM_CHARGE_ALREADY_VOIDED: 409,
  CUSTOM_CHARGE_HAS_ACTIVE_SETTLEMENTS: 409,
  CUSTOM_CHARGE_TOTAL_TOO_LARGE: 422,
};

export interface AdminCustomChargeRouteOptions {
  service: AdminCustomChargeService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminCustomChargeApiErrorSchema.parse({
      code: 'INVALID_ADMIN_CUSTOM_CHARGE_REQUEST',
      message: 'Dữ liệu khoản phát sinh không hợp lệ.',
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
    if (error instanceof AdminCustomChargeDomainError) {
      reply.code(statusByErrorCode[error.code]).send(
        adminCustomChargeApiErrorSchema.parse({
          code: error.code,
          message: error.message,
        }),
      );
      return null;
    }
    throw error;
  }
}

export function registerAdminCustomChargeRoutes(
  app: FastifyInstance,
  options: AdminCustomChargeRouteOptions,
): void {
  app.post<{ Params: IdentifierParams; Body: unknown }>(
    '/admin/bills/:billId/custom-charges',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: identifierParamsSchema('billId'),
        body: createBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = createAdminCustomChargeRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.billId || !parsed.success) {
        return sendInvalidRequest(reply);
      }
      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      const result = await executeDomain(reply, () =>
        options.service.create({
          adminUserId: request.adminSession!.admin.id,
          billId: request.params.billId!,
          request: parsed.data,
        }),
      );

      return result ? adminBillDetailResponseSchema.parse(result) : reply;
    },
  );

  app.patch<{ Params: IdentifierParams; Body: unknown }>(
    '/admin/custom-charges/:chargeId',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: identifierParamsSchema('chargeId'),
        body: updateBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = updateAdminCustomChargeRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.chargeId || !parsed.success) {
        return sendInvalidRequest(reply);
      }
      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      const result = await executeDomain(reply, () =>
        options.service.update({
          adminUserId: request.adminSession!.admin.id,
          chargeId: request.params.chargeId!,
          request: parsed.data,
        }),
      );

      return result ? adminBillDetailResponseSchema.parse(result) : reply;
    },
  );

  app.post<{ Params: IdentifierParams; Body: unknown }>(
    '/admin/custom-charges/:chargeId/void',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: identifierParamsSchema('chargeId'),
        body: voidBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = voidAdminCustomChargeRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.chargeId || !parsed.success) {
        return sendInvalidRequest(reply);
      }
      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      const result = await executeDomain(reply, () =>
        options.service.void({
          adminUserId: request.adminSession!.admin.id,
          chargeId: request.params.chargeId!,
          request: parsed.data,
        }),
      );

      return result ? adminBillDetailResponseSchema.parse(result) : reply;
    },
  );
}
