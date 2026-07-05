import assert from 'node:assert/strict';
import test from 'node:test';

import { strFromU8, unzipSync } from 'fflate';
import jsQrModule from 'jsqr';
import { PNG } from 'pngjs';

type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

const decodeQr = jsQrModule as unknown as JsQrDecoder;

import { adminServicePointQrManifestSchema } from '@nhdp/contracts';

import {
  buildCustomerServicePointUrl,
  createServicePointQrAsset,
  createServicePointQrPack,
  normalizePublicOrigin,
} from './service-point-qr.js';

const servicePoint = {
  id: '019f2bbb-797d-777f-947e-848374706911',
  code: 'COURT-01',
  name: 'Sân 01',
  slug: 'san-01',
  status: 'ACTIVE' as const,
};

function decodePngQr(pngBuffer: Buffer): string {
  const png = PNG.sync.read(pngBuffer);
  const decoded = decodeQr(Uint8ClampedArray.from(png.data), png.width, png.height);

  assert.ok(decoded, 'Expected generated PNG to decode as a QR code.');
  return decoded.data;
}

void test('public origin normalization and customer URL are canonical', () => {
  assert.equal(normalizePublicOrigin('https://example.com/admin?x=1#hash'), 'https://example.com');
  assert.equal(
    buildCustomerServicePointUrl('https://example.com/', 'san-01'),
    'https://example.com/s/san-01',
  );
});

void test('generated PNG QR decodes to the canonical service point URL', async () => {
  const asset = await createServicePointQrAsset('http://localhost:8080', servicePoint);

  assert.equal(decodePngQr(asset.png), 'http://localhost:8080/s/san-01');
  assert.match(asset.svg, /^<svg/);
  assert.equal(asset.manifestEntry.pngFileName, 'san-01-qr.png');
  assert.equal(asset.manifestEntry.svgFileName, 'san-01-qr.svg');
});

void test('QR pack contains PNG, SVG and a typed manifest', async () => {
  const pack = await createServicePointQrPack('http://localhost:8080', [servicePoint]);
  const archive = unzipSync(pack.zip);
  const manifestBytes = archive['manifest.json'];
  const pngBytes = archive['png/san-01-qr.png'];
  const svgBytes = archive['svg/san-01-qr.svg'];

  assert.ok(manifestBytes);
  assert.ok(pngBytes);
  assert.ok(svgBytes);

  const manifest = adminServicePointQrManifestSchema.parse(
    JSON.parse(strFromU8(manifestBytes)) as unknown,
  );

  assert.equal(manifest.servicePoints[0]?.targetUrl, 'http://localhost:8080/s/san-01');
  assert.equal(decodePngQr(Buffer.from(pngBytes)), 'http://localhost:8080/s/san-01');
  assert.match(strFromU8(svgBytes), /^<svg/);
});
