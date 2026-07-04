import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp, type HealthResponse } from './app.js';

void test('GET /health returns the API health contract', async (context) => {
  const app = buildApp({ logger: false });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);

  const body = response.json<HealthResponse>();

  assert.equal(body.status, 'ok');
  assert.equal(body.service, '@nhdp/api');
  assert.equal(body.version, '0.0.0');
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

void test('unknown routes return 404', async (context) => {
  const app = buildApp({ logger: false });

  context.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/not-found',
  });

  assert.equal(response.statusCode, 404);
});
