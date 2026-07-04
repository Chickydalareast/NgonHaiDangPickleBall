import {
  adminCatalogApiErrorSchema,
  adminCatalogImageUploadSignatureResponseSchema,
  adminCatalogResponseSchema,
  attachAdminCatalogItemImageRequestSchema,
  createAdminCatalogCategoryRequestSchema,
  createAdminCatalogItemRequestSchema,
  updateAdminCatalogCategoryRequestSchema,
  updateAdminCatalogItemRequestSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminCatalogDomainError,
  type AdminCatalogErrorCode,
  type AdminCatalogService,
} from './admin-catalog-service.js';

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

interface CategoryParams {
  categoryId?: string;
}

interface ItemParams {
  itemId?: string;
}

const statusByErrorCode: Record<AdminCatalogErrorCode, number> = {
  ADMIN_CATALOG_VENUE_NOT_FOUND: 404,
  ADMIN_CATALOG_CATEGORY_NOT_FOUND: 404,
  ADMIN_CATALOG_ITEM_NOT_FOUND: 404,
  ADMIN_CATALOG_CATEGORY_SLUG_CONFLICT: 409,
  ADMIN_CATALOG_ITEM_SLUG_CONFLICT: 409,
  ADMIN_CATALOG_CATEGORY_MISMATCH: 409,
  ADMIN_CATALOG_IMAGE_NOT_CONFIGURED: 503,
  ADMIN_CATALOG_IMAGE_SIGNATURE_INVALID: 409,
  ADMIN_CATALOG_IMAGE_PUBLIC_ID_INVALID: 409,
};

export interface AdminCatalogRouteOptions {
  service: AdminCatalogService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function sendInvalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminCatalogApiErrorSchema.parse({
      code: 'INVALID_ADMIN_CATALOG_REQUEST',
      message: 'Dữ liệu quản lý menu không hợp lệ.',
    }),
  );
}

function sendDomainError(reply: FastifyReply, error: AdminCatalogDomainError): FastifyReply {
  return reply.code(statusByErrorCode[error.code]).send(
    adminCatalogApiErrorSchema.parse({
      code: error.code,
      message: error.message,
    }),
  );
}

function requireAdminId(request: { adminSession: { admin: { id: string } } | null }): string {
  if (!request.adminSession) {
    throw new Error('Admin session was not attached by the auth guard.');
  }

  return request.adminSession.admin.id;
}

export function registerAdminCatalogRoutes(
  app: FastifyInstance,
  options: AdminCatalogRouteOptions,
): void {
  app.get('/admin/catalog', { preHandler: options.requireAdmin }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return adminCatalogResponseSchema.parse(await options.service.getCatalog());
  });

  app.post<{ Body: unknown }>(
    '/admin/catalog/categories',
    { preHandler: options.requireAdmin, attachValidation: true },
    async (request, reply) => {
      const parsed = createAdminCatalogCategoryRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminCatalogResponseSchema.parse(
          await options.service.createCategory({
            adminUserId: requireAdminId(request),
            values: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCatalogDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: CategoryParams; Body: unknown }>(
    '/admin/catalog/categories/:categoryId',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['categoryId'],
          properties: { categoryId: { type: 'string', pattern: identifierPattern } },
        },
      },
    },
    async (request, reply) => {
      const parsed = updateAdminCatalogCategoryRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.categoryId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminCatalogResponseSchema.parse(
          await options.service.updateCategory({
            adminUserId: requireAdminId(request),
            categoryId: request.params.categoryId,
            values: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCatalogDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: unknown }>(
    '/admin/catalog/items',
    { preHandler: options.requireAdmin, attachValidation: true },
    async (request, reply) => {
      const parsed = createAdminCatalogItemRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminCatalogResponseSchema.parse(
          await options.service.createItem({
            adminUserId: requireAdminId(request),
            values: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCatalogDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: ItemParams; Body: unknown }>(
    '/admin/catalog/items/:itemId',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId'],
          properties: { itemId: { type: 'string', pattern: identifierPattern } },
        },
      },
    },
    async (request, reply) => {
      const parsed = updateAdminCatalogItemRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.itemId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminCatalogResponseSchema.parse(
          await options.service.updateItem({
            adminUserId: requireAdminId(request),
            itemId: request.params.itemId,
            values: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCatalogDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: ItemParams; Body: unknown }>(
    '/admin/catalog/items/:itemId/image-signature',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId'],
          properties: { itemId: { type: 'string', pattern: identifierPattern } },
        },
      },
    },
    async (request, reply) => {
      if (
        request.validationError ||
        !request.params.itemId ||
        (request.body !== undefined && request.body !== null)
      ) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminCatalogImageUploadSignatureResponseSchema.parse(
          await options.service.createImageUploadSignature(request.params.itemId),
        );
      } catch (error) {
        if (error instanceof AdminCatalogDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.put<{ Params: ItemParams; Body: unknown }>(
    '/admin/catalog/items/:itemId/image',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId'],
          properties: { itemId: { type: 'string', pattern: identifierPattern } },
        },
      },
    },
    async (request, reply) => {
      const parsed = attachAdminCatalogItemImageRequestSchema.safeParse(request.body);

      if (request.validationError || !request.params.itemId || !parsed.success) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminCatalogResponseSchema.parse(
          await options.service.attachImage({
            adminUserId: requireAdminId(request),
            itemId: request.params.itemId,
            values: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCatalogDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: ItemParams }>(
    '/admin/catalog/items/:itemId/image',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId'],
          properties: { itemId: { type: 'string', pattern: identifierPattern } },
        },
      },
    },
    async (request, reply) => {
      if (request.validationError || !request.params.itemId) {
        return sendInvalidRequest(reply);
      }

      try {
        return adminCatalogResponseSchema.parse(
          await options.service.removeImage({
            adminUserId: requireAdminId(request),
            itemId: request.params.itemId,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCatalogDomainError) {
          return sendDomainError(reply, error);
        }
        throw error;
      }
    },
  );
}
