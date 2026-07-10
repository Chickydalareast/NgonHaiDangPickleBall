import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = process.cwd();

function readText(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function count(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function main(): void {
  const client = readText('apps/web/src/lib/admin-api.ts');
  const app = readText('apps/api/src/app.ts');

  assert(
    count(client, "jsonRequest('PATCH', null)") === 3,
    'The three empty alert actions must send canonical application/json null payloads.',
  );

  assert(
    !/method:\s*'PATCH'/.test(client),
    'Raw bodyless PATCH request options remain in the admin API client.',
  );

  assert(
    app.includes('function registerEmptyActionContentTypeCompatibility'),
    'The scoped empty-action compatibility parser is missing.',
  );

  assert(
    count(app, 'registerEmptyActionContentTypeCompatibility(') === 3,
    'The parser must be declared once and registered only in the two empty-action route scopes.',
  );

  assert(
    app.includes('void app.register((alertApp) =>'),
    'Admin alert routes are not isolated in their own Fastify scope.',
  );

  assert(
    app.includes('void app.register((serviceRequestApp) =>'),
    'Admin service-request routes are not isolated in their own Fastify scope.',
  );

  console.log('PASS: Admin alert actions use a deterministic and scoped media contract.');
}

main();
