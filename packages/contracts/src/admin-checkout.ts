import { z } from 'zod';

import { adminBillDetailResponseSchema } from './admin-order-operations.js';

const identifierSchema = z.string().uuid();
const moneyVndSchema = z.number().int().nonnegative();
const isoTimestampSchema = z.string().datetime({ offset: true });
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/);

export const courtRentalHourlyBreakdownSchema = z
  .object({
    sequence: z.number().int().positive(),
    startsAt: timeSchema,
    endsAt: timeSchema,
    basePriceVnd: moneyVndSchema,
    surchargeVnd: moneyVndSchema,
    totalVnd: moneyVndSchema,
  })
  .strict();

export const createCourtRentalRequestSchema = z
  .object({
    idempotencyKey: identifierSchema,
    startTime: timeSchema,
    durationHours: z.number().int().min(1).max(24),
  })
  .strict();

export const courtRentalChargeSchema = z
  .object({
    id: identifierSchema,
    orderLineId: identifierSchema,
    startTime: timeSchema,
    durationHours: z.number().int().positive(),
    baseAmountVnd: moneyVndSchema,
    surchargeAmountVnd: moneyVndSchema,
    totalAmountVnd: moneyVndSchema,
    breakdown: z.array(courtRentalHourlyBreakdownSchema).min(1),
    status: z.enum(['ACTIVE', 'VOIDED']),
  })
  .strict();

export const openAdminBillResponseSchema = adminBillDetailResponseSchema;

export const createCourtRentalResponseSchema = z
  .object({
    bill: adminBillDetailResponseSchema,
    courtRental: courtRentalChargeSchema,
  })
  .strict();

export const paymentAllocationRequestSchema = z
  .object({
    lineId: identifierSchema,
    quantity: z.number().int().min(1).max(999),
  })
  .strict();

export const createPaymentBatchRequestSchema = z
  .object({
    idempotencyKey: identifierSchema,
    allocations: z.array(paymentAllocationRequestSchema).min(1).max(500),
  })
  .strict();

export const checkoutItemSchema = z
  .object({
    lineKind: z.enum(['CATALOG', 'MANUAL_PRODUCT', 'MANUAL_TIME']),
    itemName: z.string().min(1),
    unitName: z.string().min(1),
    unitPriceVnd: moneyVndSchema,
    quantity: z.number().int().positive(),
    totalVnd: moneyVndSchema,
    sourceLineIds: z.array(identifierSchema).min(1),
  })
  .strict();

export const checkoutPaymentBatchSchema = z
  .object({
    id: identifierSchema,
    createdAt: isoTimestampSchema,
    totalVnd: moneyVndSchema,
    items: z.array(checkoutItemSchema).min(1),
  })
  .strict();

export const adminCheckoutPreviewResponseSchema = z
  .object({
    billId: identifierSchema,
    revision: isoTimestampSchema,
    generatedAt: isoTimestampSchema,
    servicePoint: z
      .object({
        id: identifierSchema,
        code: z.string().min(1),
        name: z.string().min(1),
      })
      .strict(),
    unresolvedOrderCount: z.number().int().nonnegative(),
    grossTotalVnd: moneyVndSchema,
    paidTotalVnd: moneyVndSchema,
    waivedTotalVnd: moneyVndSchema,
    outstandingTotalVnd: moneyVndSchema,
    outstandingItems: z.array(checkoutItemSchema),
    waivedItems: z.array(checkoutItemSchema),
    paymentBatches: z.array(checkoutPaymentBatchSchema),
    allItems: z.array(checkoutItemSchema),
    courtRentals: z.array(courtRentalChargeSchema),
  })
  .strict();

export const createPaymentBatchResponseSchema = z
  .object({
    paymentBatchId: identifierSchema,
    totalVnd: moneyVndSchema,
    bill: adminBillDetailResponseSchema,
  })
  .strict();

export const adminCheckoutApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_CHECKOUT_REQUEST',
      'ADMIN_SERVICE_POINT_NOT_FOUND',
      'ADMIN_SERVICE_POINT_INACTIVE',
      'ADMIN_BILL_NOT_FOUND',
      'ADMIN_BILL_NOT_OPEN',
      'COURT_RENTAL_ALREADY_EXISTS',
      'COURT_RENTAL_TOTAL_TOO_LARGE',
      'PAYMENT_ALLOCATION_INVALID',
      'PAYMENT_BATCH_IDEMPOTENCY_CONFLICT',
      'PAYMENT_TOTAL_TOO_LARGE',
      'BILL_REVISION_STALE',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type OpenAdminBillResponse = z.infer<typeof openAdminBillResponseSchema>;
export type CreateCourtRentalRequest = z.infer<typeof createCourtRentalRequestSchema>;
export type CourtRentalCharge = z.infer<typeof courtRentalChargeSchema>;
export type CreateCourtRentalResponse = z.infer<typeof createCourtRentalResponseSchema>;
export type CreatePaymentBatchRequest = z.infer<typeof createPaymentBatchRequestSchema>;
export type CheckoutItem = z.infer<typeof checkoutItemSchema>;
export type CheckoutPaymentBatch = z.infer<typeof checkoutPaymentBatchSchema>;
export type AdminCheckoutPreviewResponse = z.infer<typeof adminCheckoutPreviewResponseSchema>;
export type CreatePaymentBatchResponse = z.infer<typeof createPaymentBatchResponseSchema>;
export type AdminCheckoutApiError = z.infer<typeof adminCheckoutApiErrorSchema>;
