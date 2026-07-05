import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminServicePointQrManifestSchema,
  adminServicePointsApiErrorSchema,
  adminServicePointsResponseSchema,
  authSessionResponseSchema,
  publicServicePointContextSchema,
} from '@nhdp/contracts';
import { parse } from 'dotenv';
import { strFromU8, unzipSync } from 'fflate';
import jsQrModule from 'jsqr';
import { PNG } from 'pngjs';

type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

const decodeQr = jsQrModule as unknown as JsQrDecoder;
import { Pool } from 'pg';
import { z } from 'zod';

const localEnvironment = existsSync('.env')
  ? parse(readFileSync('.env'))
  : parse(readFileSync('.env.example'));
const environment = z
  .object({
    ADMIN_SEED_PASSWORD: z.string().min(16).max(200),
    ADMIN_SEED_USERNAME: z.string().regex(/^[a-z0-9._-]{3,50}$/),
    CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    DATABASE_URL: z.string().min(1),
    WEB_ORIGIN: z.url(),
  })
  .parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

function cookiePair(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('Admin login did not return a session cookie.');
  return header.split(';', 1)[0] ?? '';
}

function decodePngQr(pngBuffer: Buffer): string {
  const png = PNG.sync.read(pngBuffer);
  const decoded = decodeQr(Uint8ClampedArray.from(png.data), png.width, png.height);
  assert.ok(decoded, 'Expected downloaded PNG to decode as a QR code.');
  return decoded.data;
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step10pro-a-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let servicePointId: string | null = null;

  try {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: environment.ADMIN_SEED_USERNAME,
        password: environment.ADMIN_SEED_PASSWORD,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(loginResponse.status, 200);
    authSessionResponseSchema.parse(await loginResponse.clone().json());
    const cookie = cookiePair(loginResponse);

    const initialResponse = await fetch(`${baseUrl}/api/admin/service-points`, {
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(initialResponse.status, 200);
    const initial = adminServicePointsResponseSchema.parse(await initialResponse.json());
    const seededCourts = initial.servicePoints.filter((entry) =>
      /^san-(0[1-9]|10)$/.test(entry.slug),
    );
    assert.equal(seededCourts.length, 10);
    const court01 = initial.servicePoints.find((entry) => entry.slug === 'san-01');
    assert.ok(court01);

    const pngResponse = await fetch(
      `${baseUrl}/api/admin/service-points/${encodeURIComponent(court01.id)}/qr.png`,
      {
        headers: { Accept: 'image/png', Cookie: cookie },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(pngResponse.status, 200);
    assert.match(pngResponse.headers.get('content-type') ?? '', /^image\/png/);
    assert.equal(decodePngQr(Buffer.from(await pngResponse.arrayBuffer())), court01.customerUrl);

    const svgResponse = await fetch(
      `${baseUrl}/api/admin/service-points/${encodeURIComponent(court01.id)}/qr.svg`,
      {
        headers: { Accept: 'image/svg+xml', Cookie: cookie },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(svgResponse.status, 200);
    assert.match(svgResponse.headers.get('content-type') ?? '', /^image\/svg\+xml/);
    assert.match(await svgResponse.text(), /^<svg/);

    const createResponse = await fetch(`${baseUrl}/api/admin/service-points`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        code: `VERIFY-${suffix.toUpperCase()}`,
        name: 'Sân HTTP verify',
        slug: `verify-http-${suffix}`,
        status: 'ACTIVE',
        sortOrder: 999_500,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(createResponse.status, 200);
    const afterCreate = adminServicePointsResponseSchema.parse(await createResponse.json());
    const created = afterCreate.servicePoints.find(
      (entry) => entry.slug === `verify-http-${suffix}`,
    );
    assert.ok(created);
    servicePointId = created.id;

    const publicActiveResponse = await fetch(
      `${baseUrl}/api/public/service-points/${created.slug}/context`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(publicActiveResponse.status, 200);
    publicServicePointContextSchema.parse(await publicActiveResponse.json());

    const immutableSlugResponse = await fetch(
      `${baseUrl}/api/admin/service-points/${encodeURIComponent(servicePointId)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ slug: `changed-${suffix}` }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(immutableSlugResponse.status, 400);
    assert.equal(
      adminServicePointsApiErrorSchema.parse(await immutableSlugResponse.json()).code,
      'INVALID_ADMIN_SERVICE_POINT_REQUEST',
    );

    const deactivateResponse = await fetch(
      `${baseUrl}/api/admin/service-points/${encodeURIComponent(servicePointId)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ status: 'INACTIVE' }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(deactivateResponse.status, 200);
    const afterDeactivate = adminServicePointsResponseSchema.parse(await deactivateResponse.json());
    assert.equal(
      afterDeactivate.servicePoints.find((entry) => entry.id === servicePointId)?.status,
      'INACTIVE',
    );

    const publicInactiveResponse = await fetch(
      `${baseUrl}/api/public/service-points/${created.slug}/context`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(publicInactiveResponse.status, 404);

    const packResponse = await fetch(`${baseUrl}/api/admin/service-points/qr-pack.zip`, {
      headers: { Accept: 'application/zip', Cookie: cookie },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(packResponse.status, 200);
    assert.match(packResponse.headers.get('content-type') ?? '', /^application\/zip/);
    const archive = unzipSync(new Uint8Array(await packResponse.arrayBuffer()));
    const manifestBytes = archive['manifest.json'];
    assert.ok(manifestBytes);
    const manifest = adminServicePointQrManifestSchema.parse(
      JSON.parse(strFromU8(manifestBytes)) as unknown,
    );
    assert.equal(
      manifest.servicePoints.filter((entry) => /^san-(0[1-9]|10)$/.test(entry.slug)).length,
      10,
    );
    assert.equal(
      manifest.servicePoints.some((entry) => entry.servicePointId === servicePointId),
      false,
    );
    const court01Png = archive['png/san-01-qr.png'];
    assert.ok(court01Png);
    assert.equal(decodePngQr(Buffer.from(court01Png)), court01.customerUrl);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(logoutResponse.status, 200);

    console.log(`Admin service points and QR HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          seededCourts: seededCourts.length,
          qrPngDecoded: true,
          qrSvgDownloaded: true,
          qrPackDecoded: true,
          immutableSlugRejected: true,
          inactivePublicContextStatus: publicInactiveResponse.status,
          inactiveExcludedFromQrPack: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (servicePointId) {
      await pool.query(`DELETE FROM activity_logs WHERE entity_id = $1`, [servicePointId]);
      await pool.query(`DELETE FROM service_points WHERE id = $1`, [servicePointId]);
    }
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
