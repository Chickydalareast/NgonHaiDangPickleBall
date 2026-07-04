import { z } from 'zod';

const identifierSchema = z.string().uuid();

function orderEvent(type: 'order.created' | 'order.accepted' | 'order.served' | 'order.cancelled') {
  return z
    .object({
      type: z.literal(type),
      servicePointId: identifierSchema,
      billId: identifierSchema,
      orderId: identifierSchema,
    })
    .strict();
}

export const adminRealtimeOrderCreatedEventSchema = orderEvent('order.created');
export const adminRealtimeOrderAcceptedEventSchema = orderEvent('order.accepted');
export const adminRealtimeOrderServedEventSchema = orderEvent('order.served');
export const adminRealtimeOrderCancelledEventSchema = orderEvent('order.cancelled');
export const adminRealtimeBillUpdatedEventSchema = z
  .object({
    type: z.literal('bill.updated'),
    servicePointId: identifierSchema,
    billId: identifierSchema,
    orderId: identifierSchema,
  })
  .strict();
export const adminRealtimeBillCompletedEventSchema = z
  .object({
    type: z.literal('bill.completed'),
    servicePointId: identifierSchema,
    billId: identifierSchema,
  })
  .strict();

export const adminRealtimeEventSchema = z.discriminatedUnion('type', [
  adminRealtimeOrderCreatedEventSchema,
  adminRealtimeOrderAcceptedEventSchema,
  adminRealtimeOrderServedEventSchema,
  adminRealtimeOrderCancelledEventSchema,
  adminRealtimeBillUpdatedEventSchema,
  adminRealtimeBillCompletedEventSchema,
]);

export type AdminRealtimeOrderCreatedEvent = z.infer<typeof adminRealtimeOrderCreatedEventSchema>;
export type AdminRealtimeOrderAcceptedEvent = z.infer<typeof adminRealtimeOrderAcceptedEventSchema>;
export type AdminRealtimeOrderServedEvent = z.infer<typeof adminRealtimeOrderServedEventSchema>;
export type AdminRealtimeOrderCancelledEvent = z.infer<
  typeof adminRealtimeOrderCancelledEventSchema
>;
export type AdminRealtimeBillUpdatedEvent = z.infer<typeof adminRealtimeBillUpdatedEventSchema>;
export type AdminRealtimeBillCompletedEvent = z.infer<typeof adminRealtimeBillCompletedEventSchema>;
export type AdminRealtimeEvent = z.infer<typeof adminRealtimeEventSchema>;
