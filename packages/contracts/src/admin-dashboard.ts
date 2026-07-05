import { z } from 'zod';

const identifierSchema = z.string().uuid();
const moneyVndSchema = z.number().int().nonnegative();

export const adminDashboardServicePointSchema = z
  .object({
    id: identifierSchema,
    venueId: identifierSchema,
    venueName: z.string().min(1).max(160),
    code: z.string().min(1).max(40),
    slug: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    billLifecycleState: z.enum(['NONE', 'OPEN_EMPTY', 'OPEN_ACTIVE']),
    openBill: z
      .object({
        id: identifierSchema,
        totalVnd: moneyVndSchema,
        openedAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    pendingOrderCount: z.number().int().nonnegative(),
    hasPendingServiceRequest: z.boolean(),
    pendingServiceRequest: z
      .object({
        id: identifierSchema,
        message: z.string().min(1).max(200).nullable(),
        createdAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const adminDashboardResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    servicePoints: z.array(adminDashboardServicePointSchema),
  })
  .strict();

export type AdminDashboardServicePoint = z.infer<typeof adminDashboardServicePointSchema>;
export type AdminDashboardResponse = z.infer<typeof adminDashboardResponseSchema>;
