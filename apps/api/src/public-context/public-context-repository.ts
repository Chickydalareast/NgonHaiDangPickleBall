import {
  publicServicePointContextSchema,
  type PublicCatalogItem,
  type PublicServicePointContext,
} from '@nhdp/contracts';
import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { catalogCategories, catalogItems, servicePoints, venues } from '../db/schema.js';

export interface PublicContextRepository {
  findByServicePointSlug(slug: string): Promise<PublicServicePointContext | null>;
}

export function createPublicContextRepository(db: Database): PublicContextRepository {
  return {
    async findByServicePointSlug(slug: string): Promise<PublicServicePointContext | null> {
      return db.transaction(async (transaction) => {
        const [contextRow] = await transaction
          .select({
            venueId: venues.id,
            venueSlug: venues.slug,
            venueName: venues.name,
            venueTimezone: venues.timezone,
            venueCurrency: venues.currency,
            servicePointId: servicePoints.id,
            servicePointCode: servicePoints.code,
            servicePointSlug: servicePoints.slug,
            servicePointName: servicePoints.name,
          })
          .from(servicePoints)
          .innerJoin(venues, eq(servicePoints.venueId, venues.id))
          .where(
            and(
              eq(servicePoints.slug, slug),
              eq(servicePoints.status, 'ACTIVE'),
              eq(venues.status, 'ACTIVE'),
            ),
          )
          .limit(1);

        if (!contextRow) {
          return null;
        }

        const categoryRows = await transaction
          .select({
            id: catalogCategories.id,
            slug: catalogCategories.slug,
            name: catalogCategories.name,
            description: catalogCategories.description,
            sortOrder: catalogCategories.sortOrder,
          })
          .from(catalogCategories)
          .where(
            and(
              eq(catalogCategories.venueId, contextRow.venueId),
              eq(catalogCategories.status, 'ACTIVE'),
            ),
          )
          .orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name));

        const itemRows = await transaction
          .select({
            id: catalogItems.id,
            categoryId: catalogItems.categoryId,
            slug: catalogItems.slug,
            name: catalogItems.name,
            description: catalogItems.description,
            unitName: catalogItems.unitName,
            priceVnd: catalogItems.priceVnd,
            sortOrder: catalogItems.sortOrder,
            imagePublicId: catalogItems.imagePublicId,
            imageVersion: catalogItems.imageVersion,
            imageWidth: catalogItems.imageWidth,
            imageHeight: catalogItems.imageHeight,
            imageFormat: catalogItems.imageFormat,
            imageAlt: catalogItems.imageAlt,
          })
          .from(catalogItems)
          .where(
            and(
              eq(catalogItems.venueId, contextRow.venueId),
              eq(catalogItems.status, 'ACTIVE'),
              eq(catalogItems.isAvailable, true),
            ),
          )
          .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.name));

        const itemsByCategory = new Map<string, PublicCatalogItem[]>();

        for (const row of itemRows) {
          const categoryItems = itemsByCategory.get(row.categoryId) ?? [];

          categoryItems.push({
            id: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            unitName: row.unitName,
            priceVnd: row.priceVnd,
            sortOrder: row.sortOrder,
            image:
              row.imagePublicId === null
                ? null
                : {
                    publicId: row.imagePublicId,
                    version: row.imageVersion,
                    width: row.imageWidth,
                    height: row.imageHeight,
                    format: row.imageFormat,
                    alt: row.imageAlt,
                  },
          });

          itemsByCategory.set(row.categoryId, categoryItems);
        }

        return publicServicePointContextSchema.parse({
          venue: {
            id: contextRow.venueId,
            slug: contextRow.venueSlug,
            name: contextRow.venueName,
            timezone: contextRow.venueTimezone,
            currency: contextRow.venueCurrency,
          },
          servicePoint: {
            id: contextRow.servicePointId,
            code: contextRow.servicePointCode,
            slug: contextRow.servicePointSlug,
            name: contextRow.servicePointName,
          },
          categories: categoryRows.map((category) => ({
            ...category,
            items: itemsByCategory.get(category.id) ?? [],
          })),
          generatedAt: new Date().toISOString(),
        });
      });
    },
  };
}
