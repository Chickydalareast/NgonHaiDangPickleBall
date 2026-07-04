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
      }
    };

    eventSource.onerror = () => {
      if (!disposed) {
        setStatus('reconnecting');
      }
    };

    const handleOrderCreated = (event: Event): void => {
      const parsed = parseRealtimeEvent(event as MessageEvent<string>);

      if (parsed?.type !== 'order.created') {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    };

    eventSource.addEventListener('order.created', handleOrderCreated);

    return () => {
      disposed = true;
      eventSource.removeEventListener('order.created', handleOrderCreated);
      eventSource.close();
    };
  }, [enabled, queryClient]);

  return enabled ? status : 'idle';
}
