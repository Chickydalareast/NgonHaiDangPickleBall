import { z } from 'zod';

const identifierSchema = z.string().uuid();

export const serviceRequestMessageSchema = z.string().trim().min(3).max(200);

export const createPublicServiceRequestRequestSchema = z
  .object({
    message: serviceRequestMessageSchema.optional(),
  })
  .strict();

export const pendingServiceRequestSchema = z
  .object({
    id: identifierSchema,
    servicePointId: identifierSchema,
    billId: identifierSchema.nullable(),
    status: z.literal('PENDING'),
    message: z.string().min(1).max(200).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const createPublicServiceRequestResponseSchema = z
  .object({
    replayed: z.boolean(),
    request: pendingServiceRequestSchema,
  })
  .strict();

export const readPendingServiceRequestResponseSchema = z
  .object({
    request: pendingServiceRequestSchema.nullable(),
  })
  .strict();

export const resolveAdminServiceRequestResponseSchema = z
  .object({
    id: identifierSchema,
    servicePointId: identifierSchema,
    status: z.literal('RESOLVED'),
    resolvedAt: z.string().datetime(),
  })
  .strict();

export const serviceRequestApiErrorSchema = z
  .object({
    code: z.enum([
      'SERVICE_POINT_NOT_FOUND',
      'INVALID_SERVICE_REQUEST',
      'INVALID_ADMIN_SERVICE_REQUEST',
      'ADMIN_SERVICE_REQUEST_NOT_FOUND',
      'ADMIN_SERVICE_REQUEST_NOT_PENDING',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type CreatePublicServiceRequestRequest = z.infer<
  typeof createPublicServiceRequestRequestSchema
>;
export type PendingServiceRequest = z.infer<typeof pendingServiceRequestSchema>;
export type CreatePublicServiceRequestResponse = z.infer<
  typeof createPublicServiceRequestResponseSchema
>;
export type ReadPendingServiceRequestResponse = z.infer<
  typeof readPendingServiceRequestResponseSchema
>;
export type ResolveAdminServiceRequestResponse = z.infer<
  typeof resolveAdminServiceRequestResponseSchema
>;
export type ServiceRequestApiError = z.infer<typeof serviceRequestApiErrorSchema>;
