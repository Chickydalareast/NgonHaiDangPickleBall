import { z } from 'zod';

const identifierSchema = z.string().uuid();

export const adminRealtimeOrderCreatedEventSchema = z
  .object({
    type: z.literal('order.created'),
    servicePointId: identifierSchema,
    billId: identifierSchema,
    orderId: identifierSchema,
  })
  .strict();

export const adminRealtimeEventSchema = z.discriminatedUnion('type', [
  adminRealtimeOrderCreatedEventSchema,
]);

export type AdminRealtimeOrderCreatedEvent = z.infer<typeof adminRealtimeOrderCreatedEventSchema>;
export type AdminRealtimeEvent = z.infer<typeof adminRealtimeEventSchema>;
