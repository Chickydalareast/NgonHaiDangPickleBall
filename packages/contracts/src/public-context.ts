import { z } from 'zod';

const identifierSchema = z.string().uuid();
const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const moneyVndSchema = z.number().int().nonnegative();

export const publicCatalogImageSchema = z
  .object({
    publicId: z.string().min(1),
    version: z.number().int().nonnegative().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    format: z.string().min(1).max(20).nullable(),
    alt: z.string().min(1).max(200).nullable(),
  })
  .strict();

export const publicCatalogItemSchema = z
  .object({
    id: identifierSchema,
    slug: slugSchema,
    name: z.string().min(1).max(160),
    description: z.string().nullable(),
    unitName: z.string().min(1).max(40),
    priceVnd: moneyVndSchema,
    sortOrder: z.number().int().nonnegative(),
    image: publicCatalogImageSchema.nullable(),
  })
  .strict();

export const publicCatalogCategorySchema = z
  .object({
    id: identifierSchema,
    slug: slugSchema,
    name: z.string().min(1).max(120),
    description: z.string().nullable(),
    sortOrder: z.number().int().nonnegative(),
    items: z.array(publicCatalogItemSchema),
  })
  .strict();

export const publicServicePointContextSchema = z
  .object({
    venue: z
      .object({
        id: identifierSchema,
        slug: slugSchema,
        name: z.string().min(1).max(160),
        timezone: z.string().min(1).max(64),
        currency: z.literal('VND'),
      })
      .strict(),
    servicePoint: z
      .object({
        id: identifierSchema,
        code: z.string().min(1).max(40),
        slug: slugSchema,
        name: z.string().min(1).max(120),
      })
      .strict(),
    categories: z.array(publicCatalogCategorySchema),
    generatedAt: z.string().datetime(),
  })
  .strict();

export const publicApiErrorSchema = z
  .object({
    code: z.enum(['SERVICE_POINT_NOT_FOUND', 'INVALID_RESPONSE']),
    message: z.string().min(1),
  })
  .strict();

export type PublicCatalogImage = z.infer<typeof publicCatalogImageSchema>;
export type PublicCatalogItem = z.infer<typeof publicCatalogItemSchema>;
export type PublicCatalogCategory = z.infer<typeof publicCatalogCategorySchema>;
export type PublicServicePointContext = z.infer<typeof publicServicePointContextSchema>;
export type PublicApiError = z.infer<typeof publicApiErrorSchema>;
