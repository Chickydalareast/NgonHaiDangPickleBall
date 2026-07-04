import {
  createOrderApiErrorSchema,
  createOrderRequestSchema,
  createOrderResponseSchema,
} from '@nhdp/contracts';
import type { FastifyInstance } from 'fastify';

import {
  CreateOrderDomainError,
  type CreateOrderErrorCode,
  type CreateOrderService,
} from './create-order-service.js';

interface ServicePointParams {
  slug: string;
}

const servicePointParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug'],
  properties: {
    slug: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
  },
} as const;

const createOrderBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['idempotencyKey', 'items'],
  properties: {
    idempotencyKey: {
      type: 'string',
      maxLength: 128,
      pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    },
    note: {
      anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
    },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['catalogItemId', 'quantity'],
        properties: {
          catalogItemId: {
            type: 'string',
            pattern:
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
          },
          quantity: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
          },
        },
      },
    },
  },
} as const;

const statusByErrorCode: Record<CreateOrderErrorCode, number> = {
  SERVICE_POINT_NOT_FOUND: 404,
  CATALOG_ITEM_UNAVAILABLE: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  BILL_NOT_OPEN: 409,
  ORDER_TOTAL_TOO_LARGE: 422,
};

export interface CreateOrderRouteOptions {
  service: CreateOrderService;
}

export function registerCreateOrderRoutes(
  app: FastifyInstance,
  options: CreateOrderRouteOptions,
): void {
  app.post<{ Params: ServicePointParams; Body: unknown }>(
    '/public/service-points/:slug/orders',
    {
      attachValidation: true,
      schema: {
        params: servicePointParamsSchema,
        body: createOrderBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (request.validationError) {
        const error = createOrderApiErrorSchema.parse({
          code: 'INVALID_ORDER_REQUEST',
          message: 'Thông tin order không hợp lệ.',
        });

        return reply.code(400).send(error);
      }

      const parsedRequest = createOrderRequestSchema.safeParse(request.body);

      if (!parsedRequest.success) {
        const error = createOrderApiErrorSchema.parse({
          code: 'INVALID_ORDER_REQUEST',
          message: 'Thông tin order không hợp lệ.',
        });

        return reply.code(400).send(error);
      }

      try {
        const result = await options.service.create({
          servicePointSlug: request.params.slug,
          request: parsedRequest.data,
        });

        return reply
          .code(result.replayed ? 200 : 201)
          .send(createOrderResponseSchema.parse(result));
      } catch (error) {
        if (error instanceof CreateOrderDomainError) {
          const payload = createOrderApiErrorSchema.parse({
            code: error.code,
            message: error.message,
          });

          return reply.code(statusByErrorCode[error.code]).send(payload);
        }

        throw error;
      }
    },
  );
}
