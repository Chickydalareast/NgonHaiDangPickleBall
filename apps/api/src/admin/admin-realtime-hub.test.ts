import assert from 'node:assert/strict';
import test from 'node:test';

import type { AdminRealtimeEvent } from '@nhdp/contracts';

import { createAdminRealtimeHub } from './admin-realtime-hub.js';

const eventFixture: AdminRealtimeEvent = {
  type: 'order.created',
  servicePointId: '019f2bbb-797d-777f-947e-848374706301',
  billId: '019f2bbb-797d-777f-947e-848374706302',
  orderId: '019f2bbb-797d-777f-947e-848374706303',
};

void test('admin realtime hub publishes to active subscribers', () => {
  const hub = createAdminRealtimeHub();
  const received: AdminRealtimeEvent[] = [];
  const unsubscribe = hub.subscribe({
    send(event) {
      received.push(event);
    },
    close() {
      return;
    },
  });

  hub.publish(eventFixture);
  assert.deepEqual(received, [eventFixture]);
  assert.equal(hub.subscriberCount(), 1);

  unsubscribe();
  hub.publish(eventFixture);
  assert.equal(received.length, 1);
  assert.equal(hub.subscriberCount(), 0);
});

void test('admin realtime hub closes every active subscriber', () => {
  const hub = createAdminRealtimeHub();
  let closedSubscribers = 0;

  hub.subscribe({
    send() {
      return;
    },
    close() {
      closedSubscribers += 1;
    },
  });
  hub.subscribe({
    send() {
      return;
    },
    close() {
      closedSubscribers += 1;
    },
  });

  hub.close();

  assert.equal(closedSubscribers, 2);
  assert.equal(hub.subscriberCount(), 0);
  hub.publish(eventFixture);
});
