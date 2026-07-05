import {
  adminServicePointsApiErrorSchema,
  adminServicePointsResponseSchema,
  createAdminServicePointRequestSchema,
  updateAdminServicePointRequestSchema,
} from '@nhdp/contracts';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';

import {
  AdminServicePointDomainError,
  type AdminServicePointService,
} from './admin-service-point-service.js';

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

interface ServicePointParams {
  servicePointId: string;
}

interface RegisterAdminServicePointRoutesOptions {
  service: AdminServicePointService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function requireAdminId(request: FastifyRequest): string {
  const adminUserId = request.adminSession?.admin.id;

  if (!adminUserId) {
    throw new Error('Admin identity was not attached by the authentication guard.');
  }

  return adminUserId;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminServicePointsApiErrorSchema.parse({
      code: 'INVALID_ADMIN_SERVICE_POINT_REQUEST',
      message: 'Dữ liệu quản lý sân không hợp lệ.',
    }),
  );
}

function sendDomainError(reply: FastifyReply, error: AdminServicePointDomainError): FastifyReply {
  const statusCode =
    error.code === 'ADMIN_SERVICE_POINT_NOT_FOUND' ||
    error.code === 'ADMIN_SERVICE_POINT_VENUE_NOT_FOUND'
      ? 404
      : 409;

  return reply.code(statusCode).send(
    adminServicePointsApiErrorSchema.parse({
      code: error.code,
      message: error.message,
    }),
  );
}

export function registerAdminServicePointRoutes(
  app: FastifyInstance,
  options: RegisterAdminServicePointRoutesOptions,
): void {
  app.get('/admin/service-points', { preHandler: options.requireAdmin }, async () =>
    adminServicePointsResponseSchema.parse(await options.service.getServicePoints()),
  );

  app.post<{ Body: unknown }>(
    '/admin/service-points',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
    },
    async (request, reply) => {
      const parsed = createAdminServicePointRequestSchema.safeParse(request.body);

      if (request.validationError || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminServicePointsResponseSchema.parse(
          await options.service.createServicePoint({
            adminUserId: requireAdminId(request),
            values: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminServicePointDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: ServicePointParams; Body: unknown }>(
    '/admin/service-points/:servicePointId',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['servicePointId'],
          properties: {
            servicePointId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = updateAdminServicePointRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.servicePointId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminServicePointsResponseSchema.parse(
          await options.service.updateServicePoint({
            adminUserId: requireAdminId(request),
            servicePointId: request.params.servicePointId,
            values: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminServicePointDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.get(
    '/admin/service-points/qr-pack.zip',
    { preHandler: options.requireAdmin },
    async (_request, reply) => {
      try {
        const pack = await options.service.createActiveQrPack();
        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Disposition', 'attachment; filename="nhdp-service-points-qr-pack.zip"')
          .header('Cache-Control', 'no-store')
          .send(pack.zip);
      } catch (error) {
        if (error instanceof AdminServicePointDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: ServicePointParams }>(
    '/admin/service-points/:servicePointId/qr.svg',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['servicePointId'],
          properties: {
            servicePointId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.validationError || !request.params.servicePointId) {
        return sendInvalidRequest(reply);
      }

      try {
        const asset = await options.service.createQrAsset(request.params.servicePointId);
        return reply
          .header('Content-Type', 'image/svg+xml; charset=utf-8')
          .header(
            'Content-Disposition',
            `attachment; filename="${asset.manifestEntry.svgFileName}"`,
          )
          .header('Cache-Control', 'no-store')
          .send(asset.svg);
      } catch (error) {
        if (error instanceof AdminServicePointDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: ServicePointParams }>(
    '/admin/service-points/:servicePointId/qr.png',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['servicePointId'],
          properties: {
            servicePointId: { type: 'string', pattern: identifierPattern },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.validationError || !request.params.servicePointId) {
        return sendInvalidRequest(reply);
      }

      try {
        const asset = await options.service.createQrAsset(request.params.servicePointId);
        return reply
          .header('Content-Type', 'image/png')
          .header(
            'Content-Disposition',
            `attachment; filename="${asset.manifestEntry.pngFileName}"`,
          )
          .header('Cache-Control', 'no-store')
          .send(asset.png);
      } catch (error) {
        if (error instanceof AdminServicePointDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );
}
