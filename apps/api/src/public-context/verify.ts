import assert from 'node:assert/strict';

import { publicServicePointContextSchema } from '@nhdp/contracts';

import { readDatabaseEnvironment } from '../config/database-environment.js';
import { createDatabaseConnection } from '../db/client.js';
import { createPublicContextRepository } from './public-context-repository.js';

async function verifyPublicContextQuery(): Promise<void> {
  const environment = readDatabaseEnvironment();
  const database = createDatabaseConnection(environment.DATABASE_URL, {
    applicationName: 'nhdp-public-context-verifier',
    maxConnections: 2,
  });

  try {
    const repository = createPublicContextRepository(database.db);
    const context = await repository.findByServicePointSlug('san-01');

    assert.ok(context, 'Expected seeded service point san-01.');

    const parsed = publicServicePointContextSchema.parse(context);
    const itemCount = parsed.categories.reduce(
      (total, category) => total + category.items.length,
      0,
    );

    assert.equal(parsed.venue.name, 'Ngon Hải Đăng Pickleball');
    assert.equal(parsed.servicePoint.slug, 'san-01');
    assert.equal(parsed.categories.length, 3);
    assert.equal(itemCount, 6);

    const missing = await repository.findByServicePointSlug('san-khong-ton-tai');

    assert.equal(missing, null);

    console.log('Public context database query verification PASS.');
    console.log(
      JSON.stringify(
        {
          categories: parsed.categories.length,
          items: itemCount,
          servicePoint: parsed.servicePoint.slug,
          venue: parsed.venue.name,
        },
        null,
        2,
      ),
    );
  } finally {
    await database.pool.end();
  }
}

void verifyPublicContextQuery().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
