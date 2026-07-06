import { seedDatabase } from './seed-service.js';

const productionSeedConfirmation = 'I_UNDERSTAND_THIS_IS_ONE_TIME_BOOTSTRAP';

if (
  process.env.NODE_ENV === 'production' &&
  process.env.ALLOW_PRODUCTION_SEED !== productionSeedConfirmation
) {
  throw new Error(
    `Production seed is disabled. Set ALLOW_PRODUCTION_SEED=${productionSeedConfirmation} only for the explicit one-time bootstrap command.`,
  );
}

void seedDatabase()
  .then((summary) => {
    console.log('Database seed completed successfully.');
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
