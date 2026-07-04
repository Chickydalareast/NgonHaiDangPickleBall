import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  adminCatalogImageUploadSignatureResponseSchema,
  type AdminCatalogImageUploadSignatureResponse,
  type AttachAdminCatalogItemImageRequest,
} from '@nhdp/contracts';

import type { CloudinaryEnvironment } from '../config/cloudinary-environment.js';

const ALLOWED_FORMATS = 'jpg,jpeg,png,webp' as const;
const INCOMING_TRANSFORMATION = 'c_limit,w_1600,h_1600' as const;

export interface CatalogMediaConfiguration {
  configured: boolean;
  cloudName: string | null;
}

export interface CatalogMediaService {
  configuration: CatalogMediaConfiguration;
  createUploadSignature(itemId: string): AdminCatalogImageUploadSignatureResponse;
  verifyUploadResponse(itemId: string, input: AttachAdminCatalogItemImageRequest): boolean;
}

function signParameters(
  parameters: Record<string, string | number | boolean>,
  apiSecret: string,
  algorithm: 'sha1' | 'sha256',
): string {
  const serialized = Object.entries(parameters)
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');

  return createHash(algorithm).update(`${serialized}${apiSecret}`).digest('hex');
}

function safeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length || !/^[a-f0-9]+$/.test(left) || !/^[a-f0-9]+$/.test(right)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function requireCredentials(environment: CloudinaryEnvironment): {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
} {
  if (
    !environment.configured ||
    environment.cloudName === null ||
    environment.apiKey === null ||
    environment.apiSecret === null
  ) {
    throw new Error('Cloudinary catalog media is not configured.');
  }

  return {
    cloudName: environment.cloudName,
    apiKey: environment.apiKey,
    apiSecret: environment.apiSecret,
  };
}

export function buildCatalogImagePublicId(itemId: string): string {
  return `nhdp/catalog/items/${itemId}/${Date.now()}-${randomBytes(10).toString('hex')}`;
}

export function createCatalogMediaService(
  environment: CloudinaryEnvironment,
  now: () => Date = () => new Date(),
): CatalogMediaService {
  return {
    configuration: {
      configured: environment.configured,
      cloudName: environment.cloudName,
    },

    createUploadSignature(itemId) {
      const credentials = requireCredentials(environment);
      const timestamp = Math.floor(now().getTime() / 1_000);
      const publicId = buildCatalogImagePublicId(itemId);
      const signature = signParameters(
        {
          allowed_formats: ALLOWED_FORMATS,
          public_id: publicId,
          timestamp,
          transformation: INCOMING_TRANSFORMATION,
        },
        credentials.apiSecret,
        'sha256',
      );

      return adminCatalogImageUploadSignatureResponseSchema.parse({
        uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/upload`,
        cloudName: credentials.cloudName,
        apiKey: credentials.apiKey,
        timestamp,
        signature,
        publicId,
        parameters: {
          allowedFormats: ALLOWED_FORMATS,
          transformation: INCOMING_TRANSFORMATION,
        },
      });
    },

    verifyUploadResponse(itemId, input) {
      const credentials = requireCredentials(environment);
      const expectedPrefix = `nhdp/catalog/items/${itemId}/`;

      if (!input.publicId.startsWith(expectedPrefix)) {
        return false;
      }

      const parameters = {
        public_id: input.publicId,
        version: input.version,
      };
      const expectedSha1 = signParameters(parameters, credentials.apiSecret, 'sha1');
      const expectedSha256 = signParameters(parameters, credentials.apiSecret, 'sha256');

      return (
        safeHexEqual(input.signature, expectedSha1) || safeHexEqual(input.signature, expectedSha256)
      );
    },
  };
}
