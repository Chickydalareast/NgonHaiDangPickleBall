import { seedDatabase } from './seed-service.js';

void seedDatabase()
  .then((summary) => {
    console.log('Database seed completed successfully.');
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
