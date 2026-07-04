import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadEnvironmentFile } from 'dotenv';
import { z } from 'zod';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    loadEnvironmentFile({ path: candidate, quiet: true });
    break;
  }
}

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must use the postgresql:// or postgres:// protocol',
    ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
});

const seedEnvironmentSchema = databaseEnvironmentSchema.extend({
  ADMIN_SEED_USERNAME: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/),
  ADMIN_SEED_PASSWORD: z.string().min(16).max(200),
});

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
export type SeedEnvironment = z.infer<typeof seedEnvironmentSchema>;

export function readDatabaseEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): DatabaseEnvironment {
  const result = databaseEnvironmentSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid database environment:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

export function readSeedEnvironment(source: NodeJS.ProcessEnv = process.env): SeedEnvironment {
  const result = seedEnvironmentSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid seed environment:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
