import { verifyDatabaseFoundation } from './verify-service.js';

void verifyDatabaseFoundation()
  .then((counts) => {
    console.log('Database foundation verification PASS.');
    console.log(JSON.stringify(counts, null, 2));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
