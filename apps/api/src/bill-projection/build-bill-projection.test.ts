import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { buildBillProjection } from './build-bill-projection.js';

const itemId = '019f2bbb-797d-777f-947e-848374706501';
const order1 = '019f2bbb-797d-777f-947e-848374706502';
const order2 = '019f2bbb-797d-777f-947e-848374706503';

void test('bill projection combines equivalent active snapshots across orders', () => {
  const summary = buildBillProjection({
    orders: [
      { id: order1, status: 'SERVED' },
      { id: order2, status: 'PENDING' },
    ],
    lines: [
      {
        id: '019f2bbb-797d-777f-947e-848374706504',
        orderId: order1,
        catalogItemId: itemId,
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 10_000,
        quantity: 3,
        lineTotalVnd: 30_000,
        status: 'ACTIVE',
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
      },
      {
        id: '019f2bbb-797d-777f-947e-848374706505',
        orderId: order2,
        catalogItemId: itemId,
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 10_000,
        quantity: 2,
        lineTotalVnd: 20_000,
        status: 'ACTIVE',
        createdAt: new Date('2026-07-05T01:00:00.000Z'),
      },
    ],
  });

  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0]?.orderedQuantity, 5);
  assert.equal(summary.items[0]?.outstandingQuantity, 5);
  assert.equal(summary.grossTotalVnd, 50_000);
  assert.equal(summary.outstandingTotalVnd, 50_000);
  assert.equal(summary.items[0]?.sourceOrderIds.length, 2);
});

void test('bill projection keeps price snapshots separate and excludes voided or cancelled lines', () => {
  const summary = buildBillProjection({
    orders: [
      { id: order1, status: 'SERVED' },
      { id: order2, status: 'CANCELLED' },
    ],
    lines: [
      {
        id: '019f2bbb-797d-777f-947e-848374706506',
        orderId: order1,
        catalogItemId: itemId,
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 10_000,
        quantity: 1,
        lineTotalVnd: 10_000,
        status: 'ACTIVE',
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
      },
      {
        id: '019f2bbb-797d-777f-947e-848374706507',
        orderId: order1,
        catalogItemId: itemId,
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 12_000,
        quantity: 1,
        lineTotalVnd: 12_000,
        status: 'ACTIVE',
        createdAt: new Date('2026-07-05T00:01:00.000Z'),
      },
      {
        id: '019f2bbb-797d-777f-947e-848374706508',
        orderId: order1,
        catalogItemId: itemId,
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 10_000,
        quantity: 4,
        lineTotalVnd: 40_000,
        status: 'VOIDED',
        createdAt: new Date('2026-07-05T00:02:00.000Z'),
      },
      {
        id: '019f2bbb-797d-777f-947e-848374706509',
        orderId: order2,
        catalogItemId: itemId,
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 10_000,
        quantity: 5,
        lineTotalVnd: 50_000,
        status: 'ACTIVE',
        createdAt: new Date('2026-07-05T00:03:00.000Z'),
      },
    ],
  });

  assert.equal(summary.items.length, 2);
  assert.deepEqual(
    summary.items.map((item) => item.unitPriceVnd),
    [10_000, 12_000],
  );
  assert.equal(summary.grossTotalVnd, 22_000);
});

void test('bill projection allocates paid and waived quantities and ignores reversals', () => {
  const orderId = randomUUID();
  const lineId = randomUUID();
  const summary = buildBillProjection({
    orders: [{ id: orderId, status: 'SERVED' }],
    lines: [
      {
        id: lineId,
        orderId,
        lineKind: 'CATALOG',
        catalogItemId: randomUUID(),
        itemName: 'Nước suối',
        unitName: 'Chai',
        imagePublicId: null,
        unitPriceVnd: 10_000,
        quantity: 5,
        lineTotalVnd: 50_000,
        status: 'ACTIVE',
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    ],
    settlements: [
      {
        id: randomUUID(),
        lineId,
        type: 'PAID',
        status: 'ACTIVE',
        quantity: 2,
        amountVnd: 20_000,
      },
      {
        id: randomUUID(),
        lineId,
        type: 'WAIVED',
        status: 'ACTIVE',
        quantity: 1,
        amountVnd: 10_000,
      },
      {
        id: randomUUID(),
        lineId,
        type: 'PAID',
        status: 'REVERSED',
        quantity: 1,
        amountVnd: 10_000,
      },
    ],
  });

  assert.equal(summary.grossTotalVnd, 50_000);
  assert.equal(summary.paidTotalVnd, 20_000);
  assert.equal(summary.waivedTotalVnd, 10_000);
  assert.equal(summary.outstandingTotalVnd, 20_000);
  assert.equal(summary.items[0]?.paidQuantity, 2);
  assert.equal(summary.items[0]?.waivedQuantity, 1);
  assert.equal(summary.items[0]?.outstandingQuantity, 2);
});

void test('bill projection rejects settlement quantities above line quantity', () => {
  const orderId = randomUUID();
  const lineId = randomUUID();

  assert.throws(
    () =>
      buildBillProjection({
        orders: [{ id: orderId, status: 'SERVED' }],
        lines: [
          {
            id: lineId,
            orderId,
            catalogItemId: randomUUID(),
            itemName: 'Nước suối',
            unitName: 'Chai',
            imagePublicId: null,
            unitPriceVnd: 10_000,
            quantity: 2,
            lineTotalVnd: 20_000,
            status: 'ACTIVE',
            createdAt: new Date('2026-07-05T00:00:00.000Z'),
          },
        ],
        settlements: [
          {
            id: randomUUID(),
            lineId,
            type: 'PAID',
            status: 'ACTIVE',
            quantity: 3,
            amountVnd: 30_000,
          },
        ],
      }),
    /exceed quantity/u,
  );
});
