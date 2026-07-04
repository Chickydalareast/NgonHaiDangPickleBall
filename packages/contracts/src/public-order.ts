import { z } from 'zod';

const identifierSchema = z.string().uuid();
const moneyVndSchema = z.number().int().nonnegative();

export const createOrderLineRequestSchema = z
  .object({
    catalogItemId: identifierSchema,
    quantity: z.number().int().min(1).max(50),
  })
  .strict();

export const createOrderRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    note: z.string().trim().max(500).nullable().optional(),
    items: z.array(createOrderLineRequestSchema).min(1).max(30),
  })
  .strict()
  .superRefine((request, context) => {
    const seen = new Set<string>();

    request.items.forEach((item, index) => {
      if (seen.has(item.catalogItemId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'catalogItemId'],
          message: 'Mỗi sản phẩm chỉ được xuất hiện một lần trong order.',
        });
      }

      seen.add(item.catalogItemId);
    });
  });

export const createOrderResponseSchema = z
  .object({
    replayed: z.boolean(),
    order: z
      .object({
        id: identifierSchema,
        status: z.enum(['PENDING', 'ACCEPTED', 'SERVED', 'CANCELLED']),
        note: z.string().nullable(),
        totalVnd: moneyVndSchema,
        createdAt: z.string().datetime(),
      })
      .strict(),
    bill: z
      .object({
        id: identifierSchema,
        status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED']),
        subtotalVnd: moneyVndSchema,
        totalVnd: moneyVndSchema,
      })
      .strict(),
    lines: z.array(
      z
        .object({
          id: identifierSchema,
          catalogItemId: identifierSchema,
          itemName: z.string().min(1).max(160),
          unitName: z.string().min(1).max(40),
          imagePublicId: z.string().nullable(),
          unitPriceVnd: moneyVndSchema,
          quantity: z.number().int().positive(),
          lineTotalVnd: moneyVndSchema,
          status: z.enum(['ACTIVE', 'VOIDED']),
        })
        .strict(),
    ),
  })
  .strict();

export const createOrderApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ORDER_REQUEST',
      'SERVICE_POINT_NOT_FOUND',
      'CATALOG_ITEM_UNAVAILABLE',
      'IDEMPOTENCY_KEY_REUSED',
      'BILL_NOT_OPEN',
      'ORDER_TOTAL_TOO_LARGE',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type CreateOrderLineRequest = z.infer<typeof createOrderLineRequestSchema>;
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;
export type CreateOrderApiError = z.infer<typeof createOrderApiErrorSchema>;
