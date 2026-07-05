import { zipSync, strToU8 } from 'fflate';
import { PNG } from 'pngjs';
import qrcodeFactory from 'qrcode-generator';

import {
  adminServicePointQrManifestSchema,
  type AdminServicePointQrManifest,
  type AdminServicePointQrManifestEntry,
} from '@nhdp/contracts';

const QR_TARGET_WIDTH = 1_024;
const QR_MARGIN_MODULES = 4;
const QR_ERROR_CORRECTION_LEVEL = 'M' as const;

export interface ServicePointQrIdentity {
  id: string;
  code: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ServicePointQrAsset {
  manifestEntry: AdminServicePointQrManifestEntry;
  png: Buffer;
  svg: string;
}

export interface ServicePointQrPack {
  manifest: AdminServicePointQrManifest;
  zip: Buffer;
}

export function normalizePublicOrigin(origin: string): string {
  const parsed = new URL(origin);
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function buildCustomerServicePointUrl(publicOrigin: string, slug: string): string {
  return new URL(
    `/s/${encodeURIComponent(slug)}`,
    `${normalizePublicOrigin(publicOrigin)}/`,
  ).toString();
}

function buildFileBaseName(servicePoint: ServicePointQrIdentity): string {
  return `${servicePoint.slug}-qr`;
}

function createQrMatrix(payload: string) {
  const qr = qrcodeFactory(0, QR_ERROR_CORRECTION_LEVEL);
  qr.addData(payload, 'Byte');
  qr.make();
  return qr;
}

function renderPng(payload: string): Buffer {
  const qr = createQrMatrix(payload);
  const moduleCount = qr.getModuleCount();
  const totalModules = moduleCount + QR_MARGIN_MODULES * 2;
  const moduleSize = Math.max(1, Math.floor(QR_TARGET_WIDTH / totalModules));
  const imageSize = totalModules * moduleSize;
  const png = new PNG({ width: imageSize, height: imageSize, colorType: 6 });

  for (let y = 0; y < imageSize; y += 1) {
    const moduleY = Math.floor(y / moduleSize) - QR_MARGIN_MODULES;

    for (let x = 0; x < imageSize; x += 1) {
      const moduleX = Math.floor(x / moduleSize) - QR_MARGIN_MODULES;
      const isDark =
        moduleX >= 0 &&
        moduleX < moduleCount &&
        moduleY >= 0 &&
        moduleY < moduleCount &&
        qr.isDark(moduleY, moduleX);
      const offset = (y * imageSize + x) * 4;
      const channel = isDark ? 0 : 255;
      png.data[offset] = channel;
      png.data[offset + 1] = channel;
      png.data[offset + 2] = channel;
      png.data[offset + 3] = 255;
    }
  }

  return PNG.sync.write(png, { colorType: 6 });
}

function renderSvg(payload: string): string {
  return createQrMatrix(payload).createSvgTag({
    cellSize: 16,
    margin: QR_MARGIN_MODULES,
    scalable: true,
  });
}

export async function createServicePointQrAsset(
  publicOrigin: string,
  servicePoint: ServicePointQrIdentity,
): Promise<ServicePointQrAsset> {
  const targetUrl = buildCustomerServicePointUrl(publicOrigin, servicePoint.slug);
  const fileBaseName = buildFileBaseName(servicePoint);
  const [svg, png] = await Promise.all([
    Promise.resolve(renderSvg(targetUrl)),
    Promise.resolve(renderPng(targetUrl)),
  ]);

  return {
    manifestEntry: {
      servicePointId: servicePoint.id,
      code: servicePoint.code,
      name: servicePoint.name,
      slug: servicePoint.slug,
      status: servicePoint.status,
      targetUrl,
      svgFileName: `${fileBaseName}.svg`,
      pngFileName: `${fileBaseName}.png`,
    },
    png,
    svg,
  };
}

export async function createServicePointQrPack(
  publicOrigin: string,
  servicePoints: ServicePointQrIdentity[],
): Promise<ServicePointQrPack> {
  const assets = await Promise.all(
    servicePoints.map((servicePoint) => createServicePointQrAsset(publicOrigin, servicePoint)),
  );
  const manifest = adminServicePointQrManifestSchema.parse({
    generatedAt: new Date().toISOString(),
    publicOrigin: normalizePublicOrigin(publicOrigin),
    servicePoints: assets.map((asset) => asset.manifestEntry),
  });
  const archiveEntries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  for (const asset of assets) {
    archiveEntries[`svg/${asset.manifestEntry.svgFileName}`] = strToU8(asset.svg);
    archiveEntries[`png/${asset.manifestEntry.pngFileName}`] = asset.png;
  }

  return {
    manifest,
    zip: Buffer.from(zipSync(archiveEntries, { level: 6 })),
  };
}
