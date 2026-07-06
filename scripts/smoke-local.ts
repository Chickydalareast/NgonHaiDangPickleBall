import { existsSync, readFileSync } from 'node:fs';

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

const baseUrl = new URL(
  process.env.SMOKE_BASE_URL ?? process.env.WEB_ORIGIN ?? `http://127.0.0.1:${caddyPort}`,
);

const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('@nhdp/api'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
  commitSha: z.string().min(1),
});

const readinessSchema = z.object({
  status: z.literal('ready'),
  service: z.literal('@nhdp/api'),
  version: z.string(),
  timestamp: z.string(),
  commitSha: z.string().min(1),
});

async function waitFor<T>(
  label: string,
  operation: () => Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
    }
  }

  throw new Error(
    `${label} did not become ready within ${timeoutMs / 1_000}s.${
      lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
    }`,
  );
}

async function fetchJson(pathname: string): Promise<unknown> {
  const response = await fetch(new URL(pathname, baseUrl), {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`GET ${pathname} returned HTTP ${response.status}`);
  }

  return response.json();
}

async function main(): Promise<void> {
  const html = await waitFor('Caddy web shell', async () => {
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`GET / returned HTTP ${response.status}`);
    }

    const body = await response.text();

    if (!body.includes('Ngọn Hải Đăng Pickleball')) {
      throw new Error('GET / did not return the expected web shell.');
    }

    return body;
  });

  const health = await waitFor('API liveness through Caddy', async () =>
    healthSchema.parse(await fetchJson('/api/health')),
  );

  const readiness = await waitFor('API readiness through Caddy', async () =>
    readinessSchema.parse(await fetchJson('/api/ready')),
  );

  console.log(`Smoke PASS: ${baseUrl.toString()}`);
  console.log(`Web shell bytes: ${Buffer.byteLength(html, 'utf8')}`);
  console.log(
    `API health: ${health.status}, readiness=${readiness.status}, commit=${readiness.commitSha}, uptime=${health.uptimeSeconds}s`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);

  process.exitCode = 1;
});
