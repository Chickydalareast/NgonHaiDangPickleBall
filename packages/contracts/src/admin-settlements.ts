import { z } from 'zod';

const identifierSchema = z.string().uuid();
const moneyVndSchema = z.number().int().nonnegative();
const quantitySchema = z.number().int().nonnegative();
const positiveQuantitySchema = z.number().int().min(1).max(999);
const reasonSchema = z.string().trim().min(3).max(300);
const isoTimestampSchema = z.string().datetime({ offset: true });

export const adminSettlementTypeSchema = z.enum(['PAID', 'WAIVED']);
export const adminSettlementStatusSchema = z.enum(['ACTIVE', 'REVERSED']);

export const adminLineSettlementSchema = z
  .object({
    id: identifierSchema,
    type: adminSettlementTypeSchema,
    quantity: positiveQuantitySchema,
    unitPriceVnd: moneyVndSchema,
    amountVnd: moneyVndSchema,
    reason: z.string().min(3).max(300).nullable(),
    status: adminSettlementStatusSchema,
    createdByAdminUserId: identifierSchema,
    reversedByAdminUserId: identifierSchema.nullable(),
    reversalReason: z.string().min(3).max(300).nullable(),
    reversedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
  })
  .strict();

export const createPaidSettlementRequestSchema = z
  .object({
    idempotencyKey: identifierSchema,
    type: z.literal('PAID'),
    quantity: positiveQuantitySchema,
  })
  .strict();

export const createWaivedSettlementRequestSchema = z
  .object({
    idempotencyKey: identifierSchema,
    type: z.literal('WAIVED'),
    quantity: positiveQuantitySchema,
    reason: reasonSchema,
  })
  .strict();

export const createAdminSettlementRequestSchema = z.discriminatedUnion('type', [
  createPaidSettlementRequestSchema,
  createWaivedSettlementRequestSchema,
]);

export const reverseAdminSettlementRequestSchema = z
  .object({
    idempotencyKey: identifierSchema,
    reason: reasonSchema,
  })
  .strict();

export const lineSettlementTotalsSchema = z
  .object({
    paidQuantity: quantitySchema,
    waivedQuantity: quantitySchema,
    outstandingQuantity: quantitySchema,
    paidTotalVnd: moneyVndSchema,
    waivedTotalVnd: moneyVndSchema,
    outstandingTotalVnd: moneyVndSchema,
  })
  .strict();

export const adminSettlementApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_SETTLEMENT_REQUEST',
      'ADMIN_ORDER_LINE_NOT_FOUND',
      'ADMIN_SETTLEMENT_NOT_FOUND',
      'ADMIN_BILL_NOT_OPEN',
      'ORDER_LINE_NOT_SETTLEABLE',
      'SETTLEMENT_QUANTITY_EXCEEDS_OUTSTANDING',
      'SETTLEMENT_IDEMPOTENCY_CONFLICT',
      'SETTLEMENT_ALREADY_REVERSED',
      'SETTLEMENT_REVERSAL_IDEMPOTENCY_CONFLICT',
      'SETTLEMENT_TOTAL_TOO_LARGE',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type AdminSettlementType = z.infer<typeof adminSettlementTypeSchema>;
export type AdminSettlementStatus = z.infer<typeof adminSettlementStatusSchema>;
export type AdminLineSettlement = z.infer<typeof adminLineSettlementSchema>;
export type CreateAdminSettlementRequest = z.infer<typeof createAdminSettlementRequestSchema>;
export type ReverseAdminSettlementRequest = z.infer<typeof reverseAdminSettlementRequestSchema>;
export type LineSettlementTotals = z.infer<typeof lineSettlementTotalsSchema>;
export type AdminSettlementApiError = z.infer<typeof adminSettlementApiErrorSchema>;
