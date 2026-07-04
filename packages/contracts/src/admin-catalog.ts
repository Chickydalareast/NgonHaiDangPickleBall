import { z } from 'zod';

const identifierSchema = z.string().uuid();
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const nullableTextSchema = z.string().trim().max(1_000).nullable();
const moneyVndSchema = z.number().int().nonnegative().max(2_000_000_000);
const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const adminCatalogImageSchema = z
  .object({
    publicId: z.string().min(1).max(500),
    version: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: z.string().min(1).max(20),
    alt: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const adminCatalogItemSchema = z
  .object({
    id: identifierSchema,
    categoryId: identifierSchema,
    name: z.string().min(1).max(160),
    slug: slugSchema,
    description: z.string().nullable(),
    unitName: z.string().min(1).max(40),
    priceVnd: moneyVndSchema,
    status: statusSchema,
    isAvailable: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    image: adminCatalogImageSchema.nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const adminCatalogCategorySchema = z
  .object({
    id: identifierSchema,
    name: z.string().min(1).max(120),
    slug: slugSchema,
    description: z.string().nullable(),
    status: statusSchema,
    sortOrder: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    items: z.array(adminCatalogItemSchema),
  })
  .strict();

export const adminCatalogResponseSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    venue: z
      .object({
        id: identifierSchema,
        name: z.string().min(1).max(160),
      })
      .strict(),
    media: z
      .object({
        configured: z.boolean(),
        cloudName: z.string().min(1).nullable(),
      })
      .strict(),
    categories: z.array(adminCatalogCategorySchema),
  })
  .strict();

export const createAdminCatalogCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    description: nullableTextSchema,
    status: statusSchema,
    sortOrder: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const updateAdminCatalogCategoryRequestSchema = createAdminCatalogCategoryRequestSchema;

export const createAdminCatalogItemRequestSchema = z
  .object({
    categoryId: identifierSchema,
    name: z.string().trim().min(1).max(160),
    slug: slugSchema,
    description: nullableTextSchema,
    unitName: z.string().trim().min(1).max(40),
    priceVnd: moneyVndSchema,
    status: statusSchema,
    isAvailable: z.boolean(),
    sortOrder: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const updateAdminCatalogItemRequestSchema = createAdminCatalogItemRequestSchema;

export const adminCatalogImageUploadSignatureResponseSchema = z
  .object({
    uploadUrl: z.url(),
    cloudName: z.string().min(1),
    apiKey: z.string().min(1),
    timestamp: z.number().int().positive(),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    publicId: z.string().min(1),
    parameters: z
      .object({
        allowedFormats: z.literal('jpg,jpeg,png,webp'),
        transformation: z.literal('c_limit,w_1600,h_1600'),
      })
      .strict(),
  })
  .strict();

export const attachAdminCatalogItemImageRequestSchema = z
  .object({
    publicId: z.string().min(1).max(500),
    version: z.number().int().positive(),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
    format: z.enum(['jpg', 'jpeg', 'png', 'webp']),
    signature: z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/),
    alt: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const adminCatalogApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_CATALOG_REQUEST',
      'ADMIN_CATALOG_VENUE_NOT_FOUND',
      'ADMIN_CATALOG_CATEGORY_NOT_FOUND',
      'ADMIN_CATALOG_ITEM_NOT_FOUND',
      'ADMIN_CATALOG_CATEGORY_SLUG_CONFLICT',
      'ADMIN_CATALOG_ITEM_SLUG_CONFLICT',
      'ADMIN_CATALOG_CATEGORY_MISMATCH',
      'ADMIN_CATALOG_IMAGE_NOT_CONFIGURED',
      'ADMIN_CATALOG_IMAGE_SIGNATURE_INVALID',
      'ADMIN_CATALOG_IMAGE_PUBLIC_ID_INVALID',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type AdminCatalogImage = z.infer<typeof adminCatalogImageSchema>;
export type AdminCatalogItem = z.infer<typeof adminCatalogItemSchema>;
export type AdminCatalogCategory = z.infer<typeof adminCatalogCategorySchema>;
export type AdminCatalogResponse = z.infer<typeof adminCatalogResponseSchema>;
export type CreateAdminCatalogCategoryRequest = z.infer<
  typeof createAdminCatalogCategoryRequestSchema
>;
export type UpdateAdminCatalogCategoryRequest = z.infer<
  typeof updateAdminCatalogCategoryRequestSchema
>;
export type CreateAdminCatalogItemRequest = z.infer<typeof createAdminCatalogItemRequestSchema>;
export type UpdateAdminCatalogItemRequest = z.infer<typeof updateAdminCatalogItemRequestSchema>;
export type AdminCatalogImageUploadSignatureResponse = z.infer<
  typeof adminCatalogImageUploadSignatureResponseSchema
>;
export type AttachAdminCatalogItemImageRequest = z.infer<
  typeof attachAdminCatalogItemImageRequestSchema
>;
export type AdminCatalogApiError = z.infer<typeof adminCatalogApiErrorSchema>;
