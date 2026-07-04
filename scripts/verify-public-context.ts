import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  publicApiErrorSchema,
  publicServicePointContextSchema,
} from '../packages/contracts/dist/index.js';
import { parse } from 'dotenv';
import { z } from 'zod';

const localEnvironment = existsSync('.env')
  ? parse(readFileSync('.env'))
  : parse(readFileSync('.env.example'));

const caddyPort = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .parse(localEnvironment.CADDY_HTTP_PORT ?? 8080);

const baseUrl = `http://127.0.0.1:${caddyPort}`;

async function main(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/public/service-points/san-01/context`, {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  assert.equal(response.status, 200);

  const context = publicServicePointContextSchema.parse(await response.json());
  const itemCount = context.categories.reduce(
    (total, category) => total + category.items.length,
    0,
  );

  assert.equal(context.venue.name, 'Ngon Hải Đăng Pickleball');
  assert.equal(context.servicePoint.slug, 'san-01');
  assert.equal(context.categories.length, 3);
  assert.equal(itemCount, 6);

  const missingResponse = await fetch(
    `${baseUrl}/api/public/service-points/khong-ton-tai/context`,
    {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  assert.equal(missingResponse.status, 404);

  const missingError = publicApiErrorSchema.parse(await missingResponse.json());

  assert.equal(missingError.code, 'SERVICE_POINT_NOT_FOUND');

  console.log(`Public context HTTP verification PASS: ${baseUrl}`);
  console.log(
    JSON.stringify(
      {
        categories: context.categories.length,
        items: itemCount,
        servicePoint: context.servicePoint.slug,
        venue: context.venue.name,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
