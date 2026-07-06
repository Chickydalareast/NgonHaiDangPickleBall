import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface AdminManifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

const repositoryRoot = process.cwd();
const sourceOnly = process.argv.includes('--source-only');

function readConfiguredPort(): string {
  if (!existsSync(resolve(repositoryRoot, '.env'))) {
    return '8080';
  }

  const match = /^CADDY_HTTP_PORT\s*=\s*["']?(\d+)["']?\s*$/mu.exec(readText('.env'));
  return match?.[1] ?? '8080';
}

const baseUrl =
  process.env.WEB_ORIGIN ??
  `http://127.0.0.1:${process.env.CADDY_HTTP_PORT ?? readConfiguredPort()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readText(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function readManifest(): AdminManifest {
  const raw = readText('apps/web/public/admin.webmanifest');
  return JSON.parse(raw) as AdminManifest;
}

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  assert(buffer.subarray(0, 8).equals(signature), 'Icon is not a valid PNG file.');
  assert(buffer.toString('ascii', 12, 16) === 'IHDR', 'PNG does not contain an IHDR header.');

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function collectSourceFiles(directory: string): string[] {
  const absoluteDirectory = resolve(repositoryRoot, directory);

  return readdirSync(absoluteDirectory).flatMap((entry) => {
    const absolutePath = resolve(absoluteDirectory, entry);
    const relativePath = `${directory}/${entry}`.replaceAll('\\', '/');

    if (statSync(absolutePath).isDirectory()) {
      return collectSourceFiles(relativePath);
    }

    return /\.(?:ts|tsx|js|jsx|html)$/u.test(entry) ? [relativePath] : [];
  });
}

function verifySource(): void {
  const manifest = readManifest();

  assert(manifest.id === '/admin', 'Manifest id must remain /admin.');
  assert(manifest.name === 'Ngọn Hải Đăng Admin', 'Unexpected manifest name.');
  assert(manifest.short_name === 'NHĐP Admin', 'Unexpected manifest short_name.');
  assert(manifest.start_url === '/admin?source=installed', 'Unexpected manifest start_url.');
  assert(manifest.scope === '/admin', 'Manifest scope must remain /admin.');
  assert(manifest.display === 'standalone', 'Manifest display must be standalone.');
  assert(manifest.theme_color === '#109b91', 'Manifest theme color does not match UI.');
  assert(manifest.background_color === '#bec5c2', 'Manifest background color does not match UI.');
  assert(Array.isArray(manifest.icons) && manifest.icons.length === 3, 'Manifest needs 3 icons.');

  const expectedIcons = new Map([
    ['/icons/admin-192.png', { width: 192, height: 192, purpose: 'any' }],
    ['/icons/admin-512.png', { width: 512, height: 512, purpose: 'any' }],
    ['/icons/admin-maskable-512.png', { width: 512, height: 512, purpose: 'maskable' }],
  ]);

  for (const icon of manifest.icons) {
    const expected = expectedIcons.get(icon.src);

    assert(expected, `Unexpected manifest icon: ${icon.src}`);
    assert(icon.type === 'image/png', `Icon ${icon.src} must use image/png.`);
    assert(icon.purpose === expected.purpose, `Icon ${icon.src} has an unexpected purpose.`);

    const relativePath = `apps/web/public${icon.src}`;
    assert(existsSync(resolve(repositoryRoot, relativePath)), `Missing icon file: ${relativePath}`);

    const dimensions = pngDimensions(readFileSync(resolve(repositoryRoot, relativePath)));
    assert(
      dimensions.width === expected.width && dimensions.height === expected.height,
      `Unexpected dimensions for ${icon.src}: ${dimensions.width}x${dimensions.height}`,
    );
  }

  const indexHtml = readText('apps/web/index.html');
  assert(indexHtml.includes('/admin.webmanifest'), 'index.html does not reference admin manifest.');
  assert(
    indexHtml.includes("window.location.pathname.startsWith('/admin')"),
    'Manifest must only be attached on admin routes.',
  );

  const headerSource = readText('apps/web/src/components/admin-page-header.tsx');
  assert(
    headerSource.includes('<AdminInstallButton />'),
    'Shared Admin header lacks install button.',
  );

  const installSource = readText('apps/web/src/features/admin-install/admin-install-button.tsx');
  assert(
    installSource.includes('beforeinstallprompt') && installSource.includes('appinstalled'),
    'Install controller must handle beforeinstallprompt and appinstalled.',
  );

  const sourcePaths = collectSourceFiles('apps/web/src');
  const prohibitedPatterns = [
    'navigator.serviceWorker',
    'serviceWorker.register',
    'virtual:pwa-register',
    'registerSW(',
    'workbox-window',
  ];

  for (const sourcePath of sourcePaths) {
    const source = readText(sourcePath);

    for (const pattern of prohibitedPatterns) {
      assert(
        !source.includes(pattern),
        `Service Worker pattern "${pattern}" found in ${sourcePath}.`,
      );
    }
  }

  for (const prohibitedFile of [
    'apps/web/public/sw.js',
    'apps/web/public/service-worker.js',
    'apps/web/public/service-worker.ts',
  ]) {
    assert(
      !existsSync(resolve(repositoryRoot, prohibitedFile)),
      `Prohibited file exists: ${prohibitedFile}`,
    );
  }
}

async function fetchRequired(pathname: string): Promise<Response> {
  const response = await fetch(new URL(pathname, baseUrl), { signal: AbortSignal.timeout(15_000) });

  assert(response.ok, `${pathname} returned HTTP ${response.status}.`);
  return response;
}

async function verifyRuntime(): Promise<void> {
  const manifestResponse = await fetchRequired('/admin.webmanifest');
  const contentType = manifestResponse.headers.get('content-type') ?? '';

  assert(
    contentType.includes('application/manifest+json') || contentType.includes('application/json'),
    `Unexpected manifest content-type: ${contentType}`,
  );

  const runtimeManifest = (await manifestResponse.json()) as AdminManifest;
  assert(runtimeManifest.id === '/admin', 'Runtime manifest id mismatch.');
  assert(runtimeManifest.scope === '/admin', 'Runtime manifest scope mismatch.');

  for (const icon of runtimeManifest.icons) {
    const response = await fetchRequired(icon.src);
    const dimensions = pngDimensions(Buffer.from(await response.arrayBuffer()));
    const declaredSize = Number(icon.sizes.split('x')[0]);

    assert(
      dimensions.width === declaredSize && dimensions.height === declaredSize,
      `Runtime icon ${icon.src} dimensions do not match ${icon.sizes}.`,
    );
  }

  const adminHtml = await (await fetchRequired('/admin')).text();
  assert(
    adminHtml.includes('/admin.webmanifest'),
    'Admin HTML does not contain manifest bootstrap.',
  );

  await fetchRequired('/admin/catalog');
  await fetchRequired('/admin/service-points');
}

async function main(): Promise<void> {
  verifySource();

  if (!sourceOnly) {
    await verifyRuntime();
  }

  console.log(
    sourceOnly ? 'ADMIN_INSTALLABLE_SOURCE_VERIFY_PASS' : 'ADMIN_INSTALLABLE_RUNTIME_VERIFY_PASS',
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
