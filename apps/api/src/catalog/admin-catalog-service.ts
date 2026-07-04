import {
  adminCatalogResponseSchema,
  type AdminCatalogImageUploadSignatureResponse,
  type AdminCatalogResponse,
  type AttachAdminCatalogItemImageRequest,
  type CreateAdminCatalogCategoryRequest,
  type CreateAdminCatalogItemRequest,
  type UpdateAdminCatalogCategoryRequest,
  type UpdateAdminCatalogItemRequest,
} from '@nhdp/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';
import type { CatalogMediaService } from './cloudinary-catalog-media.js';

export type AdminCatalogErrorCode =
  | 'ADMIN_CATALOG_VENUE_NOT_FOUND'
  | 'ADMIN_CATALOG_CATEGORY_NOT_FOUND'
  | 'ADMIN_CATALOG_ITEM_NOT_FOUND'
  | 'ADMIN_CATALOG_CATEGORY_SLUG_CONFLICT'
  | 'ADMIN_CATALOG_ITEM_SLUG_CONFLICT'
  | 'ADMIN_CATALOG_CATEGORY_MISMATCH'
  | 'ADMIN_CATALOG_IMAGE_NOT_CONFIGURED'
  | 'ADMIN_CATALOG_IMAGE_SIGNATURE_INVALID'
  | 'ADMIN_CATALOG_IMAGE_PUBLIC_ID_INVALID';

export class AdminCatalogDomainError extends Error {
  constructor(
    readonly code: AdminCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminCatalogDomainError';
  }
}

interface VenueRow extends QueryResultRow {
  id: string;
  name: string;
}

interface CategoryRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow extends QueryResultRow {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  description: string | null;
  unit_name: string;
  price_vnd: number;
  status: 'ACTIVE' | 'INACTIVE';
  is_available: boolean;
  sort_order: number;
  image_public_id: string | null;
  image_version: string | number | null;
  image_width: number | null;
  image_height: number | null;
  image_format: string | null;
  image_alt: string | null;
  created_at: Date;
  updated_at: Date;
}

interface IdRow extends QueryResultRow {
  id: string;
}

interface ItemIdentityRow extends QueryResultRow {
  id: string;
  venue_id: string;
  image_public_id: string | null;
}

export interface AdminCatalogService {
  getCatalog(): Promise<AdminCatalogResponse>;
  createCategory(input: {
    adminUserId: string;
    values: CreateAdminCatalogCategoryRequest;
  }): Promise<AdminCatalogResponse>;
  updateCategory(input: {
    adminUserId: string;
    categoryId: string;
    values: UpdateAdminCatalogCategoryRequest;
  }): Promise<AdminCatalogResponse>;
  createItem(input: {
    adminUserId: string;
    values: CreateAdminCatalogItemRequest;
  }): Promise<AdminCatalogResponse>;
  updateItem(input: {
    adminUserId: string;
    itemId: string;
    values: UpdateAdminCatalogItemRequest;
  }): Promise<AdminCatalogResponse>;
  createImageUploadSignature(itemId: string): Promise<AdminCatalogImageUploadSignatureResponse>;
  attachImage(input: {
    adminUserId: string;
    itemId: string;
    values: AttachAdminCatalogItemImageRequest;
  }): Promise<AdminCatalogResponse>;
  removeImage(input: { adminUserId: string; itemId: string }): Promise<AdminCatalogResponse>;
}

async function readVenue(client: Pool | PoolClient): Promise<VenueRow> {
  const result = await client.query<VenueRow>(
    `
      SELECT id, name
      FROM venues
      WHERE status = 'ACTIVE'
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );
  const venue = result.rows[0];

  if (!venue) {
    throw new AdminCatalogDomainError(
      'ADMIN_CATALOG_VENUE_NOT_FOUND',
      'Không tìm thấy cơ sở đang hoạt động để quản lý menu.',
    );
  }

  return venue;
}

function mapCatalog(
  venue: VenueRow,
  categories: CategoryRow[],
  items: ItemRow[],
  mediaService: CatalogMediaService,
): AdminCatalogResponse {
  const itemsByCategory = new Map<string, ItemRow[]>();

  for (const item of items) {
    const categoryItems = itemsByCategory.get(item.category_id) ?? [];
    categoryItems.push(item);
    itemsByCategory.set(item.category_id, categoryItems);
  }

  return adminCatalogResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    venue: {
      id: venue.id,
      name: venue.name,
    },
    media: mediaService.configuration,
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      status: category.status,
      sortOrder: category.sort_order,
      createdAt: category.created_at.toISOString(),
      updatedAt: category.updated_at.toISOString(),
      items: (itemsByCategory.get(category.id) ?? []).map((item) => ({
        id: item.id,
        categoryId: item.category_id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        unitName: item.unit_name,
        priceVnd: item.price_vnd,
        status: item.status,
        isAvailable: item.is_available,
        sortOrder: item.sort_order,
        image:
          item.image_public_id === null ||
          item.image_version === null ||
          item.image_width === null ||
          item.image_height === null ||
          item.image_format === null
            ? null
            : {
                publicId: item.image_public_id,
                version: Number(item.image_version),
                width: item.image_width,
                height: item.image_height,
                format: item.image_format,
                alt: item.image_alt,
              },
        createdAt: item.created_at.toISOString(),
        updatedAt: item.updated_at.toISOString(),
      })),
    })),
  });
}

async function loadCatalog(
  pool: Pool,
  mediaService: CatalogMediaService,
): Promise<AdminCatalogResponse> {
  const venue = await readVenue(pool);
  const [categoryResult, itemResult] = await Promise.all([
    pool.query<CategoryRow>(
      `
        SELECT
          id,
          name,
          slug,
          description,
          status,
          sort_order,
          created_at,
          updated_at
        FROM catalog_categories
        WHERE venue_id = $1
        ORDER BY sort_order ASC, name ASC, id ASC
      `,
      [venue.id],
    ),
    pool.query<ItemRow>(
      `
        SELECT
          id,
          category_id,
          name,
          slug,
          description,
          unit_name,
          price_vnd,
          status,
          is_available,
          sort_order,
          image_public_id,
          image_version,
          image_width,
          image_height,
          image_format,
          image_alt,
          created_at,
          updated_at
        FROM catalog_items
        WHERE venue_id = $1
        ORDER BY sort_order ASC, name ASC, id ASC
      `,
      [venue.id],
    ),
  ]);

  return mapCatalog(venue, categoryResult.rows, itemResult.rows, mediaService);
}

async function requireCategory(
  client: PoolClient,
  categoryId: string,
  venueId: string,
): Promise<void> {
  const result = await client.query<IdRow>(
    `SELECT id FROM catalog_categories WHERE id = $1 AND venue_id = $2 LIMIT 1`,
    [categoryId, venueId],
  );

  if (!result.rows[0]) {
    throw new AdminCatalogDomainError(
      'ADMIN_CATALOG_CATEGORY_NOT_FOUND',
      'Không tìm thấy danh mục menu.',
    );
  }
}

async function requireItem(
  client: Pool | PoolClient,
  itemId: string,
  venueId: string,
): Promise<ItemIdentityRow> {
  const result = await client.query<ItemIdentityRow>(
    `
      SELECT id, venue_id, image_public_id
      FROM catalog_items
      WHERE id = $1 AND venue_id = $2
      LIMIT 1
    `,
    [itemId, venueId],
  );
  const item = result.rows[0];

  if (!item) {
    throw new AdminCatalogDomainError(
      'ADMIN_CATALOG_ITEM_NOT_FOUND',
      'Không tìm thấy mặt hàng menu.',
    );
  }

  return item;
}

async function insertActivityLog(
  client: PoolClient,
  input: {
    venueId: string;
    adminUserId: string;
    action: string;
    entityType: 'CATALOG_CATEGORY' | 'CATALOG_ITEM';
    entityId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO activity_logs (
        venue_id,
        actor_type,
        actor_admin_user_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      VALUES ($1, 'ADMIN', $2, $3, $4, $5, $6::jsonb)
    `,
    [
      input.venueId,
      input.adminUserId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

function rethrowUniqueConstraint(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error
  ) {
    if (error.constraint === 'catalog_categories_venue_slug_unique') {
      throw new AdminCatalogDomainError(
        'ADMIN_CATALOG_CATEGORY_SLUG_CONFLICT',
        'Slug danh mục đã được sử dụng.',
      );
    }

    if (error.constraint === 'catalog_items_venue_slug_unique') {
      throw new AdminCatalogDomainError(
        'ADMIN_CATALOG_ITEM_SLUG_CONFLICT',
        'Slug mặt hàng đã được sử dụng.',
      );
    }
  }

  throw error;
}

export function createAdminCatalogService(
  pool: Pool,
  mediaService: CatalogMediaService,
): AdminCatalogService {
  return {
    getCatalog() {
      return loadCatalog(pool, mediaService);
    },

    async createCategory(input) {
      try {
        await withTransaction(pool, async (client) => {
          const venue = await readVenue(client);
          const result = await client.query<IdRow>(
            `
              INSERT INTO catalog_categories (
                venue_id,
                name,
                slug,
                description,
                status,
                sort_order
              )
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id
            `,
            [
              venue.id,
              input.values.name,
              input.values.slug,
              input.values.description,
              input.values.status,
              input.values.sortOrder,
            ],
          );
          const category = result.rows[0];

          if (!category) {
            throw new Error('Category insert did not return an id.');
          }

          await insertActivityLog(client, {
            venueId: venue.id,
            adminUserId: input.adminUserId,
            action: 'catalog.category.created',
            entityType: 'CATALOG_CATEGORY',
            entityId: category.id,
            metadata: { slug: input.values.slug },
          });
        });
      } catch (error) {
        rethrowUniqueConstraint(error);
      }

      return loadCatalog(pool, mediaService);
    },

    async updateCategory(input) {
      try {
        await withTransaction(pool, async (client) => {
          const venue = await readVenue(client);
          const result = await client.query<IdRow>(
            `
              UPDATE catalog_categories
              SET name = $3,
                  slug = $4,
                  description = $5,
                  status = $6,
                  sort_order = $7,
                  updated_at = now()
              WHERE id = $1 AND venue_id = $2
              RETURNING id
            `,
            [
              input.categoryId,
              venue.id,
              input.values.name,
              input.values.slug,
              input.values.description,
              input.values.status,
              input.values.sortOrder,
            ],
          );
          const category = result.rows[0];

          if (!category) {
            throw new AdminCatalogDomainError(
              'ADMIN_CATALOG_CATEGORY_NOT_FOUND',
              'Không tìm thấy danh mục menu.',
            );
          }

          await insertActivityLog(client, {
            venueId: venue.id,
            adminUserId: input.adminUserId,
            action: 'catalog.category.updated',
            entityType: 'CATALOG_CATEGORY',
            entityId: category.id,
            metadata: {
              status: input.values.status,
              sortOrder: input.values.sortOrder,
            },
          });
        });
      } catch (error) {
        rethrowUniqueConstraint(error);
      }

      return loadCatalog(pool, mediaService);
    },

    async createItem(input) {
      try {
        await withTransaction(pool, async (client) => {
          const venue = await readVenue(client);
          await requireCategory(client, input.values.categoryId, venue.id);
          const result = await client.query<IdRow>(
            `
              INSERT INTO catalog_items (
                venue_id,
                category_id,
                name,
                slug,
                description,
                unit_name,
                price_vnd,
                status,
                is_available,
                sort_order
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              RETURNING id
            `,
            [
              venue.id,
              input.values.categoryId,
              input.values.name,
              input.values.slug,
              input.values.description,
              input.values.unitName,
              input.values.priceVnd,
              input.values.status,
              input.values.isAvailable,
              input.values.sortOrder,
            ],
          );
          const item = result.rows[0];

          if (!item) {
            throw new Error('Catalog item insert did not return an id.');
          }

          await insertActivityLog(client, {
            venueId: venue.id,
            adminUserId: input.adminUserId,
            action: 'catalog.item.created',
            entityType: 'CATALOG_ITEM',
            entityId: item.id,
            metadata: {
              slug: input.values.slug,
              priceVnd: input.values.priceVnd,
              isAvailable: input.values.isAvailable,
            },
          });
        });
      } catch (error) {
        rethrowUniqueConstraint(error);
      }

      return loadCatalog(pool, mediaService);
    },

    async updateItem(input) {
      try {
        await withTransaction(pool, async (client) => {
          const venue = await readVenue(client);
          await requireCategory(client, input.values.categoryId, venue.id);
          const result = await client.query<IdRow>(
            `
              UPDATE catalog_items
              SET category_id = $3,
                  name = $4,
                  slug = $5,
                  description = $6,
                  unit_name = $7,
                  price_vnd = $8,
                  status = $9,
                  is_available = $10,
                  sort_order = $11,
                  updated_at = now()
              WHERE id = $1 AND venue_id = $2
              RETURNING id
            `,
            [
              input.itemId,
              venue.id,
              input.values.categoryId,
              input.values.name,
              input.values.slug,
              input.values.description,
              input.values.unitName,
              input.values.priceVnd,
              input.values.status,
              input.values.isAvailable,
              input.values.sortOrder,
            ],
          );
          const item = result.rows[0];

          if (!item) {
            throw new AdminCatalogDomainError(
              'ADMIN_CATALOG_ITEM_NOT_FOUND',
              'Không tìm thấy mặt hàng menu.',
            );
          }

          await insertActivityLog(client, {
            venueId: venue.id,
            adminUserId: input.adminUserId,
            action: 'catalog.item.updated',
            entityType: 'CATALOG_ITEM',
            entityId: item.id,
            metadata: {
              categoryId: input.values.categoryId,
              priceVnd: input.values.priceVnd,
              status: input.values.status,
              isAvailable: input.values.isAvailable,
              sortOrder: input.values.sortOrder,
            },
          });
        });
      } catch (error) {
        rethrowUniqueConstraint(error);
      }

      return loadCatalog(pool, mediaService);
    },

    async createImageUploadSignature(itemId) {
      if (!mediaService.configuration.configured) {
        throw new AdminCatalogDomainError(
          'ADMIN_CATALOG_IMAGE_NOT_CONFIGURED',
          'Cloudinary chưa được cấu hình trên máy chủ.',
        );
      }

      const venue = await readVenue(pool);
      await requireItem(pool, itemId, venue.id);
      return mediaService.createUploadSignature(itemId);
    },

    async attachImage(input) {
      if (!mediaService.configuration.configured) {
        throw new AdminCatalogDomainError(
          'ADMIN_CATALOG_IMAGE_NOT_CONFIGURED',
          'Cloudinary chưa được cấu hình trên máy chủ.',
        );
      }

      const expectedPrefix = `nhdp/catalog/items/${input.itemId}/`;

      if (!input.values.publicId.startsWith(expectedPrefix)) {
        throw new AdminCatalogDomainError(
          'ADMIN_CATALOG_IMAGE_PUBLIC_ID_INVALID',
          'Ảnh tải lên không thuộc đúng mặt hàng.',
        );
      }

      if (!mediaService.verifyUploadResponse(input.itemId, input.values)) {
        throw new AdminCatalogDomainError(
          'ADMIN_CATALOG_IMAGE_SIGNATURE_INVALID',
          'Không xác minh được phản hồi tải ảnh từ Cloudinary.',
        );
      }

      await withTransaction(pool, async (client) => {
        const venue = await readVenue(client);
        const currentItem = await requireItem(client, input.itemId, venue.id);
        await client.query(
          `
            UPDATE catalog_items
            SET image_public_id = $3,
                image_version = $4,
                image_width = $5,
                image_height = $6,
                image_format = $7,
                image_alt = $8,
                updated_at = now()
            WHERE id = $1 AND venue_id = $2
          `,
          [
            input.itemId,
            venue.id,
            input.values.publicId,
            input.values.version,
            input.values.width,
            input.values.height,
            input.values.format,
            input.values.alt,
          ],
        );

        await insertActivityLog(client, {
          venueId: venue.id,
          adminUserId: input.adminUserId,
          action: 'catalog.item.image-attached',
          entityType: 'CATALOG_ITEM',
          entityId: input.itemId,
          metadata: {
            previousPublicId: currentItem.image_public_id,
            publicId: input.values.publicId,
            version: input.values.version,
          },
        });
      });

      return loadCatalog(pool, mediaService);
    },

    async removeImage(input) {
      await withTransaction(pool, async (client) => {
        const venue = await readVenue(client);
        const currentItem = await requireItem(client, input.itemId, venue.id);
        await client.query(
          `
            UPDATE catalog_items
            SET image_public_id = NULL,
                image_version = NULL,
                image_width = NULL,
                image_height = NULL,
                image_format = NULL,
                image_alt = NULL,
                updated_at = now()
            WHERE id = $1 AND venue_id = $2
          `,
          [input.itemId, venue.id],
        );

        await insertActivityLog(client, {
          venueId: venue.id,
          adminUserId: input.adminUserId,
          action: 'catalog.item.image-detached',
          entityType: 'CATALOG_ITEM',
          entityId: input.itemId,
          metadata: {
            previousPublicId: currentItem.image_public_id,
            retainedForOrderHistory: true,
          },
        });
      });

      return loadCatalog(pool, mediaService);
    },
  };
}
