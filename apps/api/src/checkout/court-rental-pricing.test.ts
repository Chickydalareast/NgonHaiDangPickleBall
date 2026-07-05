import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCourtRentalPrice } from './court-rental-pricing.js';

void test('court rental prices each hour by that block start time', () => {
  const result = calculateCourtRentalPrice('COURT-01', {
    startTime: '16:30',
    durationHours: 2,
  });

  assert.equal(result.totalAmountVnd, 240_000);
  assert.deepEqual(
    result.breakdown.map((block) => [block.startsAt, block.endsAt, block.basePriceVnd]),
    [
      ['16:30', '17:30', 100_000],
      ['17:30', '18:30', 140_000],
    ],
  );
});

void test('court 03 adds 30000 VND surcharge to every hour', () => {
  const result = calculateCourtRentalPrice('COURT-03', {
    startTime: '16:30',
    durationHours: 2,
  });

  assert.equal(result.baseAmountVnd, 240_000);
  assert.equal(result.surchargeAmountVnd, 60_000);
  assert.equal(result.totalAmountVnd, 300_000);
});

void test('hours after 22:00 and before 05:00 keep the final 120000 VND band', () => {
  const result = calculateCourtRentalPrice('COURT-01', {
    startTime: '22:30',
    durationHours: 7,
  });

  assert.equal(result.totalAmountVnd, 840_000);
  assert.equal(result.breakdown.at(-1)?.startsAt, '04:30');
  assert.ok(result.breakdown.every((block) => block.basePriceVnd === 120_000));
});
