import { z } from 'zod';

import { billProjectionSummarySchema } from './bill-projection.js';
import { lineSettlementTotalsSchema } from './admin-settlements.js';

const identifierSchema = z.string().uuid();
const moneyVndSchema = z.number().int().nonnegative();
const isoTimestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = isoTimestampSchema.nullable();

export const publicCurrentBillOrderLineSchema = z
  .object({
    id: identifierSchema,
    catalogItemId: identifierSchema.nullable(),
    lineKind: z.enum(['CATALOG', 'MANUAL_PRODUCT', 'MANUAL_TIME']),
    itemName: z.string().min(1).max(160),
    unitName: z.string().min(1).max(40),
    imagePublicId: z.string().min(1).nullable(),
    unitPriceVnd: moneyVndSchema,
    quantity: z.number().int().positive(),
    durationMinutes: z.number().int().positive().nullable(),
    billingIntervalMinutes: z.number().int().positive().nullable(),
    lineTotalVnd: moneyVndSchema,
    ...lineSettlementTotalsSchema.shape,
    status: z.enum(['ACTIVE', 'VOIDED']),
    createdAt: isoTimestampSchema,
  })
  .strict();

export const publicCurrentBillOrderSchema = z
  .object({
    id: identifierSchema,
    source: z.enum(['CUSTOMER', 'ADMIN']),
    status: z.enum(['PENDING', 'ACCEPTED', 'SERVED', 'CANCELLED']),
    totalVnd: moneyVndSchema,
    acceptedAt: nullableTimestampSchema,
    servedAt: nullableTimestampSchema,
    cancelledAt: nullableTimestampSchema,
    createdAt: isoTimestampSchema,
    lines: z.array(publicCurrentBillOrderLineSchema),
  })
  .strict();

export const publicCurrentBillResponseSchema = z
  .object({
    generatedAt: isoTimestampSchema,
    venue: z
      .object({
        id: identifierSchema,
        name: z.string().min(1).max(160),
        currency: z.literal('VND'),
      })
      .strict(),
    servicePoint: z
      .object({
        id: identifierSchema,
        code: z.string().min(1).max(40),
        name: z.string().min(1).max(120),
        slug: z.string().min(1).max(120),
      })
      .strict(),
    bill: z
      .object({
        id: identifierSchema,
        status: z.literal('OPEN'),
        openedAt: isoTimestampSchema,
        updatedAt: isoTimestampSchema,
      })
      .strict()
      .nullable(),
    summary: billProjectionSummarySchema,
    orders: z.array(publicCurrentBillOrderSchema),
  })
  .strict();

export const publicCurrentBillApiErrorSchema = z
  .object({
    code: z.enum(['INVALID_PUBLIC_BILL_REQUEST', 'SERVICE_POINT_NOT_FOUND']),
    message: z.string().min(1),
  })
  .strict();

export type PublicCurrentBillOrderLine = z.infer<typeof publicCurrentBillOrderLineSchema>;
export type PublicCurrentBillOrder = z.infer<typeof publicCurrentBillOrderSchema>;
export type PublicCurrentBillResponse = z.infer<typeof publicCurrentBillResponseSchema>;
export type PublicCurrentBillApiError = z.infer<typeof publicCurrentBillApiErrorSchema>;
