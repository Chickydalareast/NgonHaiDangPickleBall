import { runMigrations } from './migrations.js';

void runMigrations()
  .then(() => {
    console.log('Database migrations applied successfully.');
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
