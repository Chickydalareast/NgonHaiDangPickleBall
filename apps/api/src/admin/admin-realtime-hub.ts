import { adminRealtimeEventSchema, type AdminRealtimeEvent } from '@nhdp/contracts';

export interface AdminRealtimeSubscriber {
  send(event: AdminRealtimeEvent): void;
  close(): void;
}

export interface AdminRealtimeHub {
  publish(event: AdminRealtimeEvent): void;
  subscribe(subscriber: AdminRealtimeSubscriber): () => void;
  close(): void;
  subscriberCount(): number;
}

export function createAdminRealtimeHub(): AdminRealtimeHub {
  const subscribers = new Set<AdminRealtimeSubscriber>();
  let closed = false;

  return {
    publish(eventInput) {
      if (closed) {
        return;
      }

      const event = adminRealtimeEventSchema.parse(eventInput);

      for (const subscriber of subscribers) {
        try {
          subscriber.send(event);
        } catch {
          subscribers.delete(subscriber);

          try {
            subscriber.close();
          } catch {
            // Subscriber cleanup is best-effort and must not break order creation.
          }
        }
      }
    },

    subscribe(subscriber) {
      if (closed) {
        subscriber.close();
        return () => undefined;
      }

      subscribers.add(subscriber);
      let subscribed = true;

      return () => {
        if (!subscribed) {
          return;
        }

        subscribed = false;
        subscribers.delete(subscriber);
      };
    },

    close() {
      if (closed) {
        return;
      }

      closed = true;

      for (const subscriber of subscribers) {
        try {
          subscriber.close();
        } catch {
          // Continue closing the remaining subscribers.
        }
      }

      subscribers.clear();
    },

    subscriberCount() {
      return subscribers.size;
    },
  };
}
