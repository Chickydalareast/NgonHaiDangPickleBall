import { hash } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import { readDatabaseEnvironment, readSeedEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from './client.js';
import { adminUsers, catalogCategories, catalogItems, servicePoints, venues } from './schema.js';
import { withTransaction } from './transaction.js';

interface SeedSummary {
  adminCreated: boolean;
  categories: number;
  items: number;
  servicePoints: number;
  venueId: string;
}

const seedCategories = [
  {
    name: 'Nước uống',
    slug: 'nuoc-uong',
    description: 'Nước đóng chai và nước giải khát.',
    sortOrder: 10,
  },
  {
    name: 'Đồ ăn',
    slug: 'do-an',
    description: 'Món ăn nhanh phục vụ tại sân.',
    sortOrder: 20,
  },
  {
    name: 'Dịch vụ',
    slug: 'dich-vu',
    description: 'Dịch vụ và vật dụng hỗ trợ người chơi.',
    sortOrder: 30,
  },
] as const;

const seedItems = [
  {
    categorySlug: 'nuoc-uong',
    name: 'Nước suối 500ml',
    slug: 'nuoc-suoi-500ml',
    unitName: 'chai',
    priceVnd: 10_000,
    sortOrder: 10,
  },
  {
    categorySlug: 'nuoc-uong',
    name: 'Coca-Cola',
    slug: 'coca-cola',
    unitName: 'lon',
    priceVnd: 15_000,
    sortOrder: 20,
  },
  {
    categorySlug: 'nuoc-uong',
    name: 'Sting dâu',
    slug: 'sting-dau',
    unitName: 'chai',
    priceVnd: 15_000,
    sortOrder: 30,
  },
  {
    categorySlug: 'do-an',
    name: 'Mì trứng',
    slug: 'mi-trung',
    unitName: 'tô',
    priceVnd: 30_000,
    sortOrder: 10,
  },
  {
    categorySlug: 'do-an',
    name: 'Xúc xích',
    slug: 'xuc-xich',
    unitName: 'cây',
    priceVnd: 15_000,
    sortOrder: 20,
  },
  {
    categorySlug: 'dich-vu',
    name: 'Thuê vợt',
    slug: 'thue-vot',
    unitName: 'vợt',
    priceVnd: 50_000,
    sortOrder: 10,
  },
] as const;

export async function seedDatabase(
  databaseUrl = readDatabaseEnvironment().DATABASE_URL,
): Promise<SeedSummary> {
  const databaseEnvironment = readDatabaseEnvironment({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  const seedEnvironment = readSeedEnvironment({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  const { pool } = createDatabaseConnection(databaseUrl, {
    applicationName: 'nhdp-seed',
    maxConnections: databaseEnvironment.DATABASE_POOL_MAX,
  });

  try {
    return await withTransaction(
      pool,
      async (client) => {
        const tx = drizzle(client);

        const [venue] = await tx
          .insert(venues)
          .values({
            name: 'Ngon Hải Đăng Pickleball',
            slug: 'ngon-hai-dang-pickleball',
            timezone: 'Asia/Ho_Chi_Minh',
            currency: 'VND',
            status: 'ACTIVE',
          })
          .onConflictDoUpdate({
            target: venues.slug,
            set: {
              name: 'Ngon Hải Đăng Pickleball',
              timezone: 'Asia/Ho_Chi_Minh',
              currency: 'VND',
              status: 'ACTIVE',
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: venues.id });

        if (!venue) {
          throw new Error('Venue seed did not return an id.');
        }

        await tx
          .insert(servicePoints)
          .values({
            venueId: venue.id,
            code: 'COURT-01',
            name: 'Sân 01',
            slug: 'san-01',
            status: 'ACTIVE',
            sortOrder: 10,
          })
          .onConflictDoUpdate({
            target: servicePoints.slug,
            set: {
              venueId: venue.id,
              code: 'COURT-01',
              name: 'Sân 01',
              status: 'ACTIVE',
              sortOrder: 10,
              updatedAt: sql`now()`,
            },
          });

        const categoryIds = new Map<string, string>();

        for (const category of seedCategories) {
          const [seededCategory] = await tx
            .insert(catalogCategories)
            .values({
              venueId: venue.id,
              ...category,
              status: 'ACTIVE',
            })
            .onConflictDoUpdate({
              target: [catalogCategories.venueId, catalogCategories.slug],
              set: {
                name: category.name,
                description: category.description,
                status: 'ACTIVE',
                sortOrder: category.sortOrder,
                updatedAt: sql`now()`,
              },
            })
            .returning({
              id: catalogCategories.id,
              slug: catalogCategories.slug,
            });

          if (!seededCategory) {
            throw new Error(`Category seed failed for ${category.slug}.`);
          }

          categoryIds.set(seededCategory.slug, seededCategory.id);
        }

        for (const item of seedItems) {
          const categoryId = categoryIds.get(item.categorySlug);

          if (!categoryId) {
            throw new Error(`Missing category ${item.categorySlug} for seed item.`);
          }

          await tx
            .insert(catalogItems)
            .values({
              venueId: venue.id,
              categoryId,
              name: item.name,
              slug: item.slug,
              unitName: item.unitName,
              priceVnd: item.priceVnd,
              status: 'ACTIVE',
              isAvailable: true,
              sortOrder: item.sortOrder,
            })
            .onConflictDoUpdate({
              target: [catalogItems.venueId, catalogItems.slug],
              set: {
                categoryId,
                name: item.name,
                unitName: item.unitName,
                priceVnd: item.priceVnd,
                status: 'ACTIVE',
                isAvailable: true,
                sortOrder: item.sortOrder,
                updatedAt: sql`now()`,
              },
            });
        }

        const existingAdmin = await tx
          .select({ id: adminUsers.id })
          .from(adminUsers)
          .where(eq(adminUsers.username, seedEnvironment.ADMIN_SEED_USERNAME))
          .limit(1);

        let adminCreated = false;

        if (existingAdmin.length === 0) {
          const passwordHash = await hash(seedEnvironment.ADMIN_SEED_PASSWORD, {
            memoryCost: 19_456,
            timeCost: 2,
            parallelism: 1,
            outputLen: 32,
          });

          if (!passwordHash.startsWith('$argon2id$')) {
            throw new Error('Admin password was not encoded with Argon2id.');
          }

          await tx.insert(adminUsers).values({
            username: seedEnvironment.ADMIN_SEED_USERNAME,
            passwordHash,
            displayName: 'Administrator',
            role: 'ADMIN',
            status: 'ACTIVE',
          });

          adminCreated = true;
        }

        return {
          adminCreated,
          categories: seedCategories.length,
          items: seedItems.length,
          servicePoints: 1,
          venueId: venue.id,
        };
      },
      { isolationLevel: 'serializable' },
    );
  } finally {
    await pool.end();
  }
}
