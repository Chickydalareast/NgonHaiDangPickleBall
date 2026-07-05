import { z } from 'zod';

const identifierSchema = z.string().uuid();
const isoTimestampSchema = z.string().datetime({ offset: true });
const moneyVndSchema = z.number().int().nonnegative();

const adminAlertServicePointSchema = z
  .object({
    id: identifierSchema,
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
  })
  .strict();

const acknowledgementFields = {
  acknowledgedAt: isoTimestampSchema.nullable(),
  acknowledgedByAdminUserId: identifierSchema.nullable(),
};

export const adminOrderAlertSchema = z
  .object({
    kind: z.literal('ORDER'),
    orderId: identifierSchema,
    billId: identifierSchema,
    servicePoint: adminAlertServicePointSchema,
    note: z.string().nullable(),
    totalVnd: moneyVndSchema,
    lineCount: z.number().int().nonnegative(),
    totalQuantity: z.number().int().nonnegative(),
    createdAt: isoTimestampSchema,
    ...acknowledgementFields,
  })
  .strict();

export const adminServiceRequestAlertSchema = z
  .object({
    kind: z.literal('SERVICE_REQUEST'),
    serviceRequestId: identifierSchema,
    billId: identifierSchema.nullable(),
    servicePoint: adminAlertServicePointSchema,
    message: z.string().min(1).max(200).nullable(),
    createdAt: isoTimestampSchema,
    ...acknowledgementFields,
  })
  .strict();

export const adminAlertSchema = z.discriminatedUnion('kind', [
  adminOrderAlertSchema,
  adminServiceRequestAlertSchema,
]);

export const adminAlertsResponseSchema = z
  .object({
    generatedAt: isoTimestampSchema,
    alerts: z.array(adminAlertSchema),
  })
  .strict();

export const acknowledgeAdminAlertResponseSchema = z
  .object({
    kind: z.enum(['ORDER', 'SERVICE_REQUEST']),
    entityId: identifierSchema,
    servicePointId: identifierSchema,
    acknowledgedAt: isoTimestampSchema,
    acknowledgedByAdminUserId: identifierSchema,
    replayed: z.boolean(),
  })
  .strict();

export const adminAlertApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_ALERT_REQUEST',
      'ADMIN_ALERT_NOT_FOUND',
      'ADMIN_ALERT_NOT_ACTIVE',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type AdminOrderAlert = z.infer<typeof adminOrderAlertSchema>;
export type AdminServiceRequestAlert = z.infer<typeof adminServiceRequestAlertSchema>;
export type AdminAlert = z.infer<typeof adminAlertSchema>;
export type AdminAlertsResponse = z.infer<typeof adminAlertsResponseSchema>;
export type AcknowledgeAdminAlertResponse = z.infer<typeof acknowledgeAdminAlertResponseSchema>;
export type AdminAlertApiError = z.infer<typeof adminAlertApiErrorSchema>;
