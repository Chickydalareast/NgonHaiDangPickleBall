import assert from 'node:assert/strict';

import { Client } from 'pg';

import { readDatabaseEnvironment, readSeedEnvironment } from '../config/database-environment.js';
import { dropVerificationDatabase } from '../db/verification-database.js';
import { createDatabaseConnection } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed-service.js';
import { createPublicContextRepository } from '../public-context/public-context-repository.js';
import { createAdminCatalogService } from './admin-catalog-service.js';
import type { CatalogMediaService } from './cloudinary-catalog-media.js';

function quoteIdentifier(identifier: string): string {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const seedEnvironment = readSeedEnvironment();
  const sourceUrl = new URL(readDatabaseEnvironment().DATABASE_URL);
  const databaseName = `nhdp_step10_verify_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const verificationUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  verificationUrl.pathname = `/${databaseName}`;
  const adminClient = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'nhdp-step10-admin-verifier',
  });

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await runMigrations(verificationUrl.toString());
    await seedDatabase(verificationUrl.toString());
    const database = createDatabaseConnection(verificationUrl.toString(), {
      applicationName: 'nhdp-step10-verifier',
      maxConnections: 8,
    });
    const mediaService: CatalogMediaService = {
      configuration: { configured: true, cloudName: 'nhdp-verifier' },
      createUploadSignature() {
        throw new Error('Not used by database verifier.');
      },
      verifyUploadResponse() {
        return true;
      },
    };

    try {
      const admin = (
        await database.pool.query<{ id: string }>(
          `
          SELECT id
          FROM admin_users
          WHERE username = $1
          LIMIT 1
        `,
          [seedEnvironment.ADMIN_SEED_USERNAME],
        )
      ).rows[0];
      assert.ok(admin);

      const suffix = Date.now().toString(36);
      const service = createAdminCatalogService(database.pool, mediaService);
      const createdCategoryCatalog = await service.createCategory({
        adminUserId: admin.id,
        values: {
          name: 'Danh mục kiểm thử',
          slug: `verify-category-${suffix}`,
          description: 'Không quản lý tồn kho trong V1',
          status: 'ACTIVE',
          sortOrder: 9_000,
        },
      });
      const category = createdCategoryCatalog.categories.find(
        (entry) => entry.slug === `verify-category-${suffix}`,
      );
      assert.ok(category);

      const createdItemCatalog = await service.createItem({
        adminUserId: admin.id,
        values: {
          categoryId: category.id,
          name: 'Mặt hàng vô hạn',
          slug: `verify-item-${suffix}`,
          description: null,
          unitName: 'phần',
          priceVnd: 25_000,
          status: 'ACTIVE',
          isAvailable: true,
          sortOrder: 9_000,
        },
      });
      const item = createdItemCatalog.categories
        .flatMap((entry) => entry.items)
        .find((entry) => entry.slug === `verify-item-${suffix}`);
      assert.ok(item);
      assert.equal('stockQuantity' in item, false);

      const publicRepository = createPublicContextRepository(database.db, 'nhdp-verifier');
      const publicBefore = await publicRepository.findByServicePointSlug('san-01');
      assert.ok(
        publicBefore?.categories
          .flatMap((entry) => entry.items)
          .some((entry) => entry.id === item.id),
      );

      await service.updateItem({
        adminUserId: admin.id,
        itemId: item.id,
        values: {
          categoryId: category.id,
          name: item.name,
          slug: item.slug,
          description: item.description,
          unitName: item.unitName,
          priceVnd: item.priceVnd,
          status: 'ACTIVE',
          isAvailable: false,
          sortOrder: item.sortOrder,
        },
      });
      const publicUnavailable = await publicRepository.findByServicePointSlug('san-01');
      assert.equal(
        publicUnavailable?.categories
          .flatMap((entry) => entry.items)
          .some((entry) => entry.id === item.id),
        false,
      );

      const publicId = `nhdp/catalog/items/${item.id}/immutable-verifier-image`;
      const withImage = await service.attachImage({
        adminUserId: admin.id,
        itemId: item.id,
        values: {
          publicId,
          version: 1_783_217_600,
          width: 1_200,
          height: 900,
          format: 'webp',
          signature: 'a'.repeat(40),
          alt: 'Mặt hàng kiểm thử',
        },
      });
      const imagedItem = withImage.categories
        .flatMap((entry) => entry.items)
        .find((entry) => entry.id === item.id);
      assert.equal(imagedItem?.image?.publicId, publicId);

      const detached = await service.removeImage({ adminUserId: admin.id, itemId: item.id });
      assert.equal(
        detached.categories.flatMap((entry) => entry.items).find((entry) => entry.id === item.id)
          ?.image,
        null,
      );

      const inventoryColumns = await database.pool.query<{ column_name: string }>(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'catalog_items'
            AND column_name IN ('stock_quantity', 'inventory_quantity', 'quantity_on_hand')
        `,
      );
      assert.equal(inventoryColumns.rowCount, 0);

      const activityCount = (
        await database.pool.query<{ count: number }>(
          `
            SELECT COUNT(*)::integer AS count
            FROM activity_logs
            WHERE entity_id IN ($1, $2)
              AND action LIKE 'catalog.%'
          `,
          [category.id, item.id],
        )
      ).rows[0]?.count;
      assert.equal(activityCount, 5);

      console.log('Admin catalog database verification PASS.');
      console.log(
        JSON.stringify(
          {
            categoryId: category.id,
            itemId: item.id,
            unlimitedInventory: inventoryColumns.rowCount === 0,
            availabilityControlsPublicMenu: true,
            immutableImageAttachedAndDetached: true,
            activityLogs: activityCount,
          },
          null,
          2,
        ),
      );
    } finally {
      await database.pool.end();
    }
  } finally {
    await dropVerificationDatabase(adminClient, databaseName);
    await adminClient.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
