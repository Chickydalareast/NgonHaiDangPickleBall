import { z } from 'zod';

const identifierSchema = z.string().uuid();
const isoTimestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = isoTimestampSchema.nullable();
const moneyVndSchema = z.number().int().nonnegative();

export const adminOrderStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'SERVED', 'CANCELLED']);
export const adminOrderLineStatusSchema = z.enum(['ACTIVE', 'VOIDED']);
export const adminOrderSourceSchema = z.enum(['CUSTOMER', 'ADMIN']);

export const adminBillOrderLineSchema = z
  .object({
    id: identifierSchema,
    catalogItemId: identifierSchema,
    itemName: z.string().min(1),
    unitName: z.string().min(1),
    imagePublicId: z.string().nullable(),
    unitPriceVnd: moneyVndSchema,
    quantity: z.number().int().positive(),
    lineTotalVnd: moneyVndSchema,
    status: adminOrderLineStatusSchema,
    voidReason: z.string().nullable(),
    voidedAt: nullableTimestampSchema,
    createdAt: isoTimestampSchema,
  })
  .strict();

export const adminBillOrderSchema = z
  .object({
    id: identifierSchema,
    source: adminOrderSourceSchema,
    status: adminOrderStatusSchema,
    note: z.string().nullable(),
    totalVnd: moneyVndSchema,
    acceptedAt: nullableTimestampSchema,
    servedAt: nullableTimestampSchema,
    cancelledAt: nullableTimestampSchema,
    cancellationReason: z.string().nullable(),
    createdAt: isoTimestampSchema,
    lines: z.array(adminBillOrderLineSchema),
  })
  .strict();

export const adminBillDetailResponseSchema = z
  .object({
    generatedAt: isoTimestampSchema,
    venue: z
      .object({
        id: identifierSchema,
        name: z.string().min(1),
      })
      .strict(),
    servicePoint: z
      .object({
        id: identifierSchema,
        code: z.string().min(1),
        name: z.string().min(1),
        slug: z.string().min(1),
      })
      .strict(),
    bill: z
      .object({
        id: identifierSchema,
        status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED']),
        subtotalVnd: moneyVndSchema,
        totalVnd: moneyVndSchema,
        openedAt: isoTimestampSchema,
      })
      .strict(),
    orders: z.array(adminBillOrderSchema),
  })
  .strict();

const cancellationReasonSchema = z.string().trim().min(3).max(300);

export const updateAdminOrderStatusRequestSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ACCEPTED') }).strict(),
  z.object({ status: z.literal('SERVED') }).strict(),
  z
    .object({
      status: z.literal('CANCELLED'),
      reason: cancellationReasonSchema,
    })
    .strict(),
]);

export const addAdminBillItemRequestSchema = z
  .object({
    catalogItemId: identifierSchema,
    quantity: z.number().int().min(1).max(50),
  })
  .strict();

export const updateAdminOrderLineRequestSchema = z
  .object({
    quantity: z.number().int().min(1).max(50),
  })
  .strict();

export const voidAdminOrderLineRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const adminOrderOperationApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_OPERATION_REQUEST',
      'ADMIN_BILL_NOT_FOUND',
      'ADMIN_ORDER_NOT_FOUND',
      'ADMIN_ORDER_LINE_NOT_FOUND',
      'ADMIN_CATALOG_ITEM_UNAVAILABLE',
      'ADMIN_BILL_NOT_OPEN',
      'INVALID_ORDER_TRANSITION',
      'ORDER_LINE_NOT_EDITABLE',
      'ORDER_LINE_ALREADY_VOIDED',
      'ORDER_TOTAL_TOO_LARGE',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type AdminOrderStatus = z.infer<typeof adminOrderStatusSchema>;
export type AdminOrderLineStatus = z.infer<typeof adminOrderLineStatusSchema>;
export type AdminOrderSource = z.infer<typeof adminOrderSourceSchema>;
export type AdminBillOrderLine = z.infer<typeof adminBillOrderLineSchema>;
export type AdminBillOrder = z.infer<typeof adminBillOrderSchema>;
export type AdminBillDetailResponse = z.infer<typeof adminBillDetailResponseSchema>;
export type UpdateAdminOrderStatusRequest = z.infer<typeof updateAdminOrderStatusRequestSchema>;
export type AddAdminBillItemRequest = z.infer<typeof addAdminBillItemRequestSchema>;
export type UpdateAdminOrderLineRequest = z.infer<typeof updateAdminOrderLineRequestSchema>;
export type VoidAdminOrderLineRequest = z.infer<typeof voidAdminOrderLineRequestSchema>;
export type AdminOrderOperationApiError = z.infer<typeof adminOrderOperationApiErrorSchema>;
