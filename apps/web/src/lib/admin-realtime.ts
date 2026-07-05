import { adminRealtimeEventSchema, type AdminRealtimeEvent } from '@nhdp/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export type AdminRealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'idle';

function parseRealtimeEvent(message: MessageEvent<string>): AdminRealtimeEvent | null {
  try {
    return adminRealtimeEventSchema.parse(JSON.parse(message.data) as unknown);
  } catch {
    return null;
  }
}

const eventTypes: AdminRealtimeEvent['type'][] = [
  'order.created',
  'order.accepted',
  'order.served',
  'order.cancelled',
  'order.alert-acknowledged',
  'bill.updated',
  'bill.completed',
  'service-request.created',
  'service-request.resolved',
  'service-request.alert-acknowledged',
];

export function useAdminRealtime(enabled: boolean): AdminRealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Exclude<AdminRealtimeStatus, 'idle'>>('connecting');

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    const eventSource = new EventSource('/api/admin/events');

    eventSource.onopen = () => {
      if (!disposed) {
        setStatus('connected');
        void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
        void queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
      }
    };

    eventSource.onerror = () => {
      if (!disposed) {
        setStatus('reconnecting');
      }
    };

    const handleEvent = (event: Event): void => {
      const parsed = parseRealtimeEvent(event as MessageEvent<string>);

      if (!parsed) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
      if ('billId' in parsed) {
        void queryClient.invalidateQueries({ queryKey: ['admin', 'bill', parsed.billId] });
      }
    };

    for (const eventType of eventTypes) {
      eventSource.addEventListener(eventType, handleEvent);
    }

    return () => {
      disposed = true;

      for (const eventType of eventTypes) {
        eventSource.removeEventListener(eventType, handleEvent);
      }

      eventSource.close();
    };
  }, [enabled, queryClient]);

  return enabled ? status : 'idle';
}
