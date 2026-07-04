import {
  createPublicServiceRequestRequestSchema,
  createPublicServiceRequestResponseSchema,
  readPendingServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  PublicServiceRequestDomainError,
  type PublicServiceRequestService,
} from './public-service-request-service.js';

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

const createBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string', minLength: 3, maxLength: 200 },
  },
} as const;

export interface PublicServiceRequestRouteOptions {
  service: PublicServiceRequestService;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    serviceRequestApiErrorSchema.parse({
      code: 'INVALID_SERVICE_REQUEST',
      message: 'Dữ liệu gọi nhân viên không hợp lệ.',
    }),
  );
}

async function execute<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PublicServiceRequestDomainError) {
      reply.code(404).send(
        serviceRequestApiErrorSchema.parse({
          code: error.code,
          message: error.message,
        }),
      );
      return null;
    }

    throw error;
  }
}

export function registerPublicServiceRequestRoutes(
  app: FastifyInstance,
  options: PublicServiceRequestRouteOptions,
): void {
  app.get<{ Params: ServicePointParams }>(
    '/public/service-points/:slug/service-requests/pending',
    {
      attachValidation: true,
      schema: { params: servicePointParamsSchema },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (request.validationError || !request.params.slug) {
        return sendInvalidRequest(reply);
      }

      const result = await execute(reply, () => options.service.readPending(request.params.slug!));

      return result ? readPendingServiceRequestResponseSchema.parse(result) : reply;
    },
  );

  app.post<{ Params: ServicePointParams; Body: unknown }>(
    '/public/service-points/:slug/service-requests',
    {
      attachValidation: true,
      schema: {
        params: servicePointParamsSchema,
        body: createBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = createPublicServiceRequestRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.slug || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      const result = await execute(reply, () =>
        options.service.create({
          servicePointSlug: request.params.slug!,
          request: parsed.data,
        }),
      );

      if (!result) {
        return reply;
      }

      return reply
        .code(result.replayed ? 200 : 201)
        .send(createPublicServiceRequestResponseSchema.parse(result));
    },
  );
}
