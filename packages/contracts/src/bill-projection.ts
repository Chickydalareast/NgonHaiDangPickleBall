import { z } from 'zod';

const identifierSchema = z.string().uuid();
const moneyVndSchema = z.number().int().nonnegative();
const quantitySchema = z.number().int().nonnegative();
const isoTimestampSchema = z.string().datetime({ offset: true });

export const billProjectionLineKindSchema = z.enum(['CATALOG', 'MANUAL_PRODUCT', 'MANUAL_TIME']);

export const billProjectionItemSchema = z
  .object({
    lineKind: billProjectionLineKindSchema,
    catalogItemId: identifierSchema.nullable(),
    itemName: z.string().min(1).max(160),
    unitName: z.string().min(1).max(40),
    imagePublicId: z.string().min(1).nullable(),
    unitPriceVnd: moneyVndSchema,
    orderedQuantity: z.number().int().positive(),
    paidQuantity: quantitySchema,
    waivedQuantity: quantitySchema,
    outstandingQuantity: quantitySchema,
    grossTotalVnd: moneyVndSchema,
    paidTotalVnd: moneyVndSchema,
    waivedTotalVnd: moneyVndSchema,
    outstandingTotalVnd: moneyVndSchema,
    sourceOrderIds: z.array(identifierSchema).min(1),
    sourceLineIds: z.array(identifierSchema).min(1),
    firstOrderedAt: isoTimestampSchema,
  })
  .strict();

export const billProjectionSummarySchema = z
  .object({
    grossTotalVnd: moneyVndSchema,
    paidTotalVnd: moneyVndSchema,
    waivedTotalVnd: moneyVndSchema,
    outstandingTotalVnd: moneyVndSchema,
    items: z.array(billProjectionItemSchema),
  })
  .strict();

export type BillProjectionLineKind = z.infer<typeof billProjectionLineKindSchema>;
export type BillProjectionItem = z.infer<typeof billProjectionItemSchema>;
export type BillProjectionSummary = z.infer<typeof billProjectionSummarySchema>;
