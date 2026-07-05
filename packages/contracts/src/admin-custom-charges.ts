import { z } from 'zod';

import { adminBillDetailResponseSchema } from './admin-order-operations.js';

const maximumMoneyVnd = 2_147_483_647;
const identifierSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(160);
const unitNameSchema = z.string().trim().min(1).max(40);
const moneyVndSchema = z.number().int().min(0).max(maximumMoneyVnd);

const manualProductFields = {
  kind: z.literal('MANUAL_PRODUCT'),
  name: nameSchema,
  unitName: unitNameSchema,
  quantity: z.number().int().min(1).max(999),
  unitPriceVnd: moneyVndSchema,
} as const;

const manualTimeFields = {
  kind: z.literal('MANUAL_TIME'),
  name: nameSchema,
  durationMinutes: z.number().int().min(1).max(1_440),
  billingIntervalMinutes: z.number().int().min(1).max(1_440),
  pricePerIntervalVnd: moneyVndSchema,
} as const;

export const manualProductChargeRequestSchema = z
  .object({
    idempotencyKey: identifierSchema,
    ...manualProductFields,
  })
  .strict();

export const manualTimeChargeRequestSchema = z
  .object({
    idempotencyKey: identifierSchema,
    ...manualTimeFields,
  })
  .strict();

export const createAdminCustomChargeRequestSchema = z.discriminatedUnion('kind', [
  manualProductChargeRequestSchema,
  manualTimeChargeRequestSchema,
]);

export const updateManualProductChargeRequestSchema = z.object(manualProductFields).strict();
export const updateManualTimeChargeRequestSchema = z.object(manualTimeFields).strict();
export const updateAdminCustomChargeRequestSchema = z.discriminatedUnion('kind', [
  updateManualProductChargeRequestSchema,
  updateManualTimeChargeRequestSchema,
]);

export const voidAdminCustomChargeRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const adminCustomChargeResponseSchema = adminBillDetailResponseSchema;

export const adminCustomChargeApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_CUSTOM_CHARGE_REQUEST',
      'ADMIN_BILL_NOT_FOUND',
      'ADMIN_BILL_NOT_OPEN',
      'ADMIN_CUSTOM_CHARGE_NOT_FOUND',
      'CUSTOM_CHARGE_KIND_IMMUTABLE',
      'CUSTOM_CHARGE_IDEMPOTENCY_CONFLICT',
      'CUSTOM_CHARGE_NOT_EDITABLE',
      'CUSTOM_CHARGE_ALREADY_VOIDED',
      'CUSTOM_CHARGE_HAS_ACTIVE_SETTLEMENTS',
      'CUSTOM_CHARGE_TOTAL_TOO_LARGE',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type ManualProductChargeRequest = z.infer<typeof manualProductChargeRequestSchema>;
export type ManualTimeChargeRequest = z.infer<typeof manualTimeChargeRequestSchema>;
export type CreateAdminCustomChargeRequest = z.infer<typeof createAdminCustomChargeRequestSchema>;
export type UpdateAdminCustomChargeRequest = z.infer<typeof updateAdminCustomChargeRequestSchema>;
export type VoidAdminCustomChargeRequest = z.infer<typeof voidAdminCustomChargeRequestSchema>;
export type AdminCustomChargeApiError = z.infer<typeof adminCustomChargeApiErrorSchema>;
