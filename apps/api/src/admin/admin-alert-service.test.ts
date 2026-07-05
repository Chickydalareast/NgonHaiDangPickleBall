import assert from 'node:assert/strict';
import test from 'node:test';

import { adminAlertSchema, type AdminAlert } from '@nhdp/contracts';

import { sortAdminAlerts } from './admin-alert-service.js';

const servicePoint = {
  id: '019f2bbb-797d-777f-947e-848374706501',
  code: 'COURT-01',
  name: 'Sân 01',
};

function orderAlert(values: {
  orderId: string;
  createdAt: string;
  acknowledgedAt?: string | null;
}): AdminAlert {
  return adminAlertSchema.parse({
    kind: 'ORDER',
    orderId: values.orderId,
    billId: '019f2bbb-797d-777f-947e-848374706502',
    servicePoint,
    note: null,
    totalVnd: 50_000,
    lineCount: 1,
    totalQuantity: 2,
    createdAt: values.createdAt,
    acknowledgedAt: values.acknowledgedAt ?? null,
    acknowledgedByAdminUserId: values.acknowledgedAt
      ? '019f2bbb-797d-777f-947e-848374706503'
      : null,
  });
}

function serviceRequestAlert(values: {
  serviceRequestId: string;
  createdAt: string;
  acknowledgedAt?: string | null;
}): AdminAlert {
  return adminAlertSchema.parse({
    kind: 'SERVICE_REQUEST',
    serviceRequestId: values.serviceRequestId,
    billId: '019f2bbb-797d-777f-947e-848374706502',
    servicePoint,
    message: 'Cần hỗ trợ',
    createdAt: values.createdAt,
    acknowledgedAt: values.acknowledgedAt ?? null,
    acknowledgedByAdminUserId: values.acknowledgedAt
      ? '019f2bbb-797d-777f-947e-848374706503'
      : null,
  });
}

void test('sortAdminAlerts prioritizes unacknowledged service requests then orders', () => {
  const alerts = sortAdminAlerts([
    orderAlert({
      orderId: '019f2bbb-797d-777f-947e-848374706510',
      createdAt: '2026-07-05T10:03:00.000Z',
      acknowledgedAt: '2026-07-05T10:04:00.000Z',
    }),
    serviceRequestAlert({
      serviceRequestId: '019f2bbb-797d-777f-947e-848374706511',
      createdAt: '2026-07-05T10:02:00.000Z',
      acknowledgedAt: '2026-07-05T10:04:00.000Z',
    }),
    orderAlert({
      orderId: '019f2bbb-797d-777f-947e-848374706512',
      createdAt: '2026-07-05T10:01:00.000Z',
    }),
    serviceRequestAlert({
      serviceRequestId: '019f2bbb-797d-777f-947e-848374706513',
      createdAt: '2026-07-05T10:00:00.000Z',
    }),
  ]);

  assert.deepEqual(
    alerts.map((alert) =>
      alert.kind === 'ORDER' ? `ORDER:${alert.orderId}` : `SERVICE:${alert.serviceRequestId}`,
    ),
    [
      'SERVICE:019f2bbb-797d-777f-947e-848374706513',
      'ORDER:019f2bbb-797d-777f-947e-848374706512',
      'SERVICE:019f2bbb-797d-777f-947e-848374706511',
      'ORDER:019f2bbb-797d-777f-947e-848374706510',
    ],
  );
});

void test('sortAdminAlerts keeps oldest event first inside the same priority', () => {
  const alerts = sortAdminAlerts([
    orderAlert({
      orderId: '019f2bbb-797d-777f-947e-848374706520',
      createdAt: '2026-07-05T10:02:00.000Z',
    }),
    orderAlert({
      orderId: '019f2bbb-797d-777f-947e-848374706521',
      createdAt: '2026-07-05T10:01:00.000Z',
    }),
  ]);

  assert.equal(alerts[0]?.kind, 'ORDER');
  assert.equal(
    alerts[0]?.kind === 'ORDER' ? alerts[0].orderId : null,
    '019f2bbb-797d-777f-947e-848374706521',
  );
});
