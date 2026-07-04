import { publicApiErrorSchema, publicServicePointContextSchema } from '@nhdp/contracts';
import type { FastifyInstance } from 'fastify';

import type { PublicContextRepository } from './public-context-repository.js';

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

export interface PublicContextRouteOptions {
  repository: PublicContextRepository;
}

export function registerPublicContextRoutes(
  app: FastifyInstance,
  options: PublicContextRouteOptions,
): void {
  app.get<{ Params: ServicePointParams }>(
    '/public/service-points/:slug/context',
    {
      schema: {
        params: servicePointParamsSchema,
      },
    },
    async (request, reply) => {
      const context = await options.repository.findByServicePointSlug(request.params.slug);

      reply.header('Cache-Control', 'no-store');

      if (!context) {
        const error = publicApiErrorSchema.parse({
          code: 'SERVICE_POINT_NOT_FOUND',
          message: 'Không tìm thấy sân hoặc sân hiện không hoạt động.',
        });

        return reply.code(404).send(error);
      }

      return publicServicePointContextSchema.parse(context);
    },
  );
}
