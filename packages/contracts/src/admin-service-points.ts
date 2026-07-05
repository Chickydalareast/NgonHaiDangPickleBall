import { z } from 'zod';

const identifierSchema = z.string().uuid();
const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);
const servicePointCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/);
const servicePointSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const adminServicePointSchema = z
  .object({
    id: identifierSchema,
    venueId: identifierSchema,
    code: servicePointCodeSchema,
    name: z.string().min(1).max(120),
    slug: servicePointSlugSchema,
    status: statusSchema,
    sortOrder: z.number().int().nonnegative(),
    customerUrl: z.url(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const adminServicePointsResponseSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    publicOrigin: z.url(),
    venue: z
      .object({
        id: identifierSchema,
        name: z.string().min(1).max(160),
      })
      .strict(),
    servicePoints: z.array(adminServicePointSchema),
  })
  .strict();

export const createAdminServicePointRequestSchema = z
  .object({
    code: servicePointCodeSchema,
    name: z.string().trim().min(1).max(120),
    slug: servicePointSlugSchema,
    status: statusSchema,
    sortOrder: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const updateAdminServicePointRequestSchema = z
  .object({
    code: servicePointCodeSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    status: statusSchema.optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });

export const adminServicePointQrManifestEntrySchema = z
  .object({
    servicePointId: identifierSchema,
    code: servicePointCodeSchema,
    name: z.string().min(1).max(120),
    slug: servicePointSlugSchema,
    status: statusSchema,
    targetUrl: z.url(),
    svgFileName: z.string().min(1),
    pngFileName: z.string().min(1),
  })
  .strict();

export const adminServicePointQrManifestSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    publicOrigin: z.url(),
    servicePoints: z.array(adminServicePointQrManifestEntrySchema),
  })
  .strict();

export const adminServicePointsApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_SERVICE_POINT_REQUEST',
      'ADMIN_SERVICE_POINT_VENUE_NOT_FOUND',
      'ADMIN_SERVICE_POINT_NOT_FOUND',
      'ADMIN_SERVICE_POINT_SLUG_CONFLICT',
      'ADMIN_SERVICE_POINT_CODE_CONFLICT',
      'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_OPEN_BILL',
      'ADMIN_SERVICE_POINT_DEACTIVATION_BLOCKED_PENDING_REQUEST',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type AdminServicePoint = z.infer<typeof adminServicePointSchema>;
export type AdminServicePointsResponse = z.infer<typeof adminServicePointsResponseSchema>;
export type CreateAdminServicePointRequest = z.infer<typeof createAdminServicePointRequestSchema>;
export type UpdateAdminServicePointRequest = z.infer<typeof updateAdminServicePointRequestSchema>;
export type AdminServicePointQrManifestEntry = z.infer<
  typeof adminServicePointQrManifestEntrySchema
>;
export type AdminServicePointQrManifest = z.infer<typeof adminServicePointQrManifestSchema>;
export type AdminServicePointsApiError = z.infer<typeof adminServicePointsApiErrorSchema>;
