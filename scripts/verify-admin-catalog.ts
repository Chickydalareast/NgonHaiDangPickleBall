import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  adminCatalogApiErrorSchema,
  adminCatalogImageUploadSignatureResponseSchema,
  adminCatalogResponseSchema,
  authSessionResponseSchema,
  publicServicePointContextSchema,
} from '../packages/contracts/dist/index.js';
import { parse } from 'dotenv';
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
  })
  .parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

function cookiePair(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('Admin login did not return a session cookie.');
  return header.split(';', 1)[0] ?? '';
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-step10-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let categoryId: string | null = null;
  let itemId: string | null = null;

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

    const initialResponse = await fetch(`${baseUrl}/api/admin/catalog`, {
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(initialResponse.status, 200);
    const initial = adminCatalogResponseSchema.parse(await initialResponse.json());

    const categoryResponse = await fetch(`${baseUrl}/api/admin/catalog/categories`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        name: 'Danh mục HTTP verify',
        slug: `verify-category-${suffix}`,
        description: null,
        status: 'ACTIVE',
        sortOrder: 9_100,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(categoryResponse.status, 200);
    const afterCategory = adminCatalogResponseSchema.parse(await categoryResponse.json());
    categoryId =
      afterCategory.categories.find((entry) => entry.slug === `verify-category-${suffix}`)?.id ??
      null;
    assert.ok(categoryId);

    const itemResponse = await fetch(`${baseUrl}/api/admin/catalog/items`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        categoryId,
        name: 'Mặt hàng HTTP verify',
        slug: `verify-item-${suffix}`,
        description: null,
        unitName: 'phần',
        priceVnd: 30_000,
        status: 'ACTIVE',
        isAvailable: true,
        sortOrder: 9_100,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(itemResponse.status, 200);
    const afterItem = adminCatalogResponseSchema.parse(await itemResponse.json());
    const item = afterItem.categories
      .flatMap((entry) => entry.items)
      .find((entry) => entry.slug === `verify-item-${suffix}`);
    assert.ok(item);
    itemId = item.id;
    assert.equal('stockQuantity' in item, false);

    const publicBeforeResponse = await fetch(
      `${baseUrl}/api/public/service-points/san-01/context`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(publicBeforeResponse.status, 200);
    const publicBefore = publicServicePointContextSchema.parse(await publicBeforeResponse.json());
    assert.ok(
      publicBefore.categories.flatMap((entry) => entry.items).some((entry) => entry.id === itemId),
    );

    const disabledResponse = await fetch(
      `${baseUrl}/api/admin/catalog/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          categoryId,
          name: item.name,
          slug: item.slug,
          description: item.description,
          unitName: item.unitName,
          priceVnd: item.priceVnd,
          status: 'ACTIVE',
          isAvailable: false,
          sortOrder: item.sortOrder,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(disabledResponse.status, 200);
    adminCatalogResponseSchema.parse(await disabledResponse.json());

    const publicAfterResponse = await fetch(`${baseUrl}/api/public/service-points/san-01/context`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const publicAfter = publicServicePointContextSchema.parse(await publicAfterResponse.json());
    assert.equal(
      publicAfter.categories.flatMap((entry) => entry.items).some((entry) => entry.id === itemId),
      false,
    );

    const signatureResponse = await fetch(
      `${baseUrl}/api/admin/catalog/items/${encodeURIComponent(itemId)}/image-signature`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: cookie },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (initial.media.configured) {
      assert.equal(signatureResponse.status, 200);
      adminCatalogImageUploadSignatureResponseSchema.parse(await signatureResponse.json());
    } else {
      assert.equal(signatureResponse.status, 503);
      assert.equal(
        adminCatalogApiErrorSchema.parse(await signatureResponse.json()).code,
        'ADMIN_CATALOG_IMAGE_NOT_CONFIGURED',
      );
    }

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(logoutResponse.status, 200);

    console.log(`Admin catalog HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          categoryId,
          itemId,
          unlimitedInventory: true,
          availableItemVisible: true,
          unavailableItemHidden: true,
          cloudinaryConfigured: initial.media.configured,
          imageSignatureStatus: signatureResponse.status,
        },
        null,
        2,
      ),
    );
  } finally {
    if (itemId || categoryId) {
      await pool.query(`DELETE FROM activity_logs WHERE entity_id = ANY($1::uuid[])`, [
        [itemId, categoryId].filter((value): value is string => value !== null),
      ]);
    }
    if (itemId) await pool.query(`DELETE FROM catalog_items WHERE id = $1`, [itemId]);
    if (categoryId) await pool.query(`DELETE FROM catalog_categories WHERE id = $1`, [categoryId]);
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
