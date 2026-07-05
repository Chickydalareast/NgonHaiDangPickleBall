import { publicCurrentBillApiErrorSchema, publicCurrentBillResponseSchema } from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  PublicCurrentBillDomainError,
  type PublicCurrentBillService,
} from './public-current-bill-service.js';

interface ServicePointParams {
  slug?: string;
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

export interface PublicCurrentBillRouteOptions {
  service: PublicCurrentBillService;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    publicCurrentBillApiErrorSchema.parse({
      code: 'INVALID_PUBLIC_BILL_REQUEST',
      message: 'Yêu cầu xem tạm tính không hợp lệ.',
    }),
  );
}

export function registerPublicCurrentBillRoutes(
  app: FastifyInstance,
  options: PublicCurrentBillRouteOptions,
): void {
  app.get<{ Params: ServicePointParams }>(
    '/public/service-points/:slug/bill',
    {
      attachValidation: true,
      schema: { params: servicePointParamsSchema },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (request.validationError || !request.params.slug) {
        return sendInvalidRequest(reply);
      }

      try {
        const result = await options.service.read(request.params.slug);
        return publicCurrentBillResponseSchema.parse(result);
      } catch (error) {
        if (error instanceof PublicCurrentBillDomainError) {
          return reply.code(404).send(
            publicCurrentBillApiErrorSchema.parse({
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
