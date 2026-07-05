import { z } from 'zod';

const identifierSchema = z.string().uuid();

function orderEvent(
  type:
    | 'order.created'
    | 'order.accepted'
    | 'order.served'
    | 'order.cancelled'
    | 'order.alert-acknowledged',
) {
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
export const adminRealtimeOrderAlertAcknowledgedEventSchema = orderEvent(
  'order.alert-acknowledged',
);
export const adminRealtimeBillUpdatedEventSchema = z
  .object({
    type: z.literal('bill.updated'),
    servicePointId: identifierSchema,
    billId: identifierSchema,
    orderId: identifierSchema.optional(),
  })
  .strict();
export const adminRealtimeBillCompletedEventSchema = z
  .object({
    type: z.literal('bill.completed'),
    servicePointId: identifierSchema,
    billId: identifierSchema,
  })
  .strict();

export const adminRealtimeServiceRequestCreatedEventSchema = z
  .object({
    type: z.literal('service-request.created'),
    servicePointId: identifierSchema,
    serviceRequestId: identifierSchema,
  })
  .strict();
export const adminRealtimeServiceRequestResolvedEventSchema = z
  .object({
    type: z.literal('service-request.resolved'),
    servicePointId: identifierSchema,
    serviceRequestId: identifierSchema,
  })
  .strict();
export const adminRealtimeServiceRequestAlertAcknowledgedEventSchema = z
  .object({
    type: z.literal('service-request.alert-acknowledged'),
    servicePointId: identifierSchema,
    serviceRequestId: identifierSchema,
  })
  .strict();

export const adminRealtimeEventSchema = z.discriminatedUnion('type', [
  adminRealtimeOrderCreatedEventSchema,
  adminRealtimeOrderAcceptedEventSchema,
  adminRealtimeOrderServedEventSchema,
  adminRealtimeOrderCancelledEventSchema,
  adminRealtimeOrderAlertAcknowledgedEventSchema,
  adminRealtimeBillUpdatedEventSchema,
  adminRealtimeBillCompletedEventSchema,
  adminRealtimeServiceRequestCreatedEventSchema,
  adminRealtimeServiceRequestResolvedEventSchema,
  adminRealtimeServiceRequestAlertAcknowledgedEventSchema,
]);

export type AdminRealtimeOrderCreatedEvent = z.infer<typeof adminRealtimeOrderCreatedEventSchema>;
export type AdminRealtimeOrderAcceptedEvent = z.infer<typeof adminRealtimeOrderAcceptedEventSchema>;
export type AdminRealtimeOrderServedEvent = z.infer<typeof adminRealtimeOrderServedEventSchema>;
export type AdminRealtimeOrderCancelledEvent = z.infer<
  typeof adminRealtimeOrderCancelledEventSchema
>;
export type AdminRealtimeOrderAlertAcknowledgedEvent = z.infer<
  typeof adminRealtimeOrderAlertAcknowledgedEventSchema
>;
export type AdminRealtimeBillUpdatedEvent = z.infer<typeof adminRealtimeBillUpdatedEventSchema>;
export type AdminRealtimeBillCompletedEvent = z.infer<typeof adminRealtimeBillCompletedEventSchema>;
export type AdminRealtimeEvent = z.infer<typeof adminRealtimeEventSchema>;

export type AdminRealtimeServiceRequestCreatedEvent = z.infer<
  typeof adminRealtimeServiceRequestCreatedEventSchema
>;
export type AdminRealtimeServiceRequestResolvedEvent = z.infer<
  typeof adminRealtimeServiceRequestResolvedEventSchema
>;
export type AdminRealtimeServiceRequestAlertAcknowledgedEvent = z.infer<
  typeof adminRealtimeServiceRequestAlertAcknowledgedEventSchema
>;
