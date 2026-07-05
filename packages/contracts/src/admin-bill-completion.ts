import { z } from 'zod';

const identifierSchema = z.string().uuid();
const isoTimestampSchema = z.string().datetime({ offset: true });
const moneyVndSchema = z.number().int().nonnegative();

export const completeAdminBillRequestSchema = z
  .object({
    revision: isoTimestampSchema,
  })
  .strict();

export const completeAdminBillResponseSchema = z
  .object({
    billId: identifierSchema,
    servicePointId: identifierSchema,
    status: z.literal('COMPLETED'),
    totalVnd: moneyVndSchema,
    completedAt: isoTimestampSchema,
  })
  .strict();

export const adminBillCompletionApiErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_ADMIN_BILL_COMPLETION_REQUEST',
      'ADMIN_BILL_NOT_FOUND',
      'ADMIN_BILL_NOT_OPEN',
      'BILL_HAS_OUTSTANDING_SETTLEMENTS',
      'BILL_TOTAL_TOO_LARGE',
      'BILL_REVISION_STALE',
    ]),
    message: z.string().min(1),
  })
  .strict();

export type CompleteAdminBillRequest = z.infer<typeof completeAdminBillRequestSchema>;
export type CompleteAdminBillResponse = z.infer<typeof completeAdminBillResponseSchema>;
export type AdminBillCompletionApiError = z.infer<typeof adminBillCompletionApiErrorSchema>;
