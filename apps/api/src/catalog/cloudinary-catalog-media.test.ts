import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createCatalogMediaService } from './cloudinary-catalog-media.js';

const environment = {
  configured: true,
  cloudName: 'nhdp-test',
  apiKey: 'api-key',
  apiSecret: 'api-secret',
} as const;

function sign(parameters: Record<string, string | number>, algorithm: 'sha1' | 'sha256') {
  const serialized = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
  return createHash(algorithm).update(`${serialized}${environment.apiSecret}`).digest('hex');
}

void test('catalog media creates a SHA-256 signed immutable upload target', () => {
  const service = createCatalogMediaService(
    environment,
    () => new Date('2026-07-05T02:00:00.000Z'),
  );
  const itemId = '019f2bbb-797d-777f-947e-848374706901';
  const result = service.createUploadSignature(itemId);

  assert.equal(result.timestamp, 1_783_216_800);
  assert.match(result.publicId, new RegExp(`^nhdp/catalog/items/${itemId}/\\d+-[a-f0-9]{20}$`));
  assert.equal(
    result.signature,
    sign(
      {
        allowed_formats: result.parameters.allowedFormats,
        public_id: result.publicId,
        timestamp: result.timestamp,
        transformation: result.parameters.transformation,
      },
      'sha256',
    ),
  );
});

void test('catalog media verifies Cloudinary response signature and item ownership', () => {
  const service = createCatalogMediaService(environment);
  const itemId = '019f2bbb-797d-777f-947e-848374706902';
  const publicId = `nhdp/catalog/items/${itemId}/immutable-image`;
  const version = 1_783_217_600;
  const signature = sign({ public_id: publicId, version }, 'sha1');
  const response = {
    publicId,
    version,
    width: 1200,
    height: 900,
    format: 'webp' as const,
    signature,
    alt: 'Nước suối',
  };

  assert.equal(service.verifyUploadResponse(itemId, response), true);
  assert.equal(
    service.verifyUploadResponse('019f2bbb-797d-777f-947e-848374706903', response),
    false,
  );
  assert.equal(
    service.verifyUploadResponse(itemId, { ...response, signature: '0'.repeat(40) }),
    false,
  );
});
