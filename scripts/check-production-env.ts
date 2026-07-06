import { existsSync, readFileSync } from 'node:fs';

import { parse } from 'dotenv';
import { z } from 'zod';

const environmentPath = process.argv[2] ?? '.env.production';

if (!existsSync(environmentPath)) {
  throw new Error(`Production environment file not found: ${environmentPath}`);
}

const schema = z
  .object({
    PRODUCTION_DOMAIN: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.includes('://'), 'Use a hostname without protocol.')
      .refine((value) => !value.includes('/'), 'Use a hostname without a path.')
      .refine(
        (value) => !/^(?:localhost|127\.|0\.0\.0\.0)/iu.test(value),
        'Localhost is forbidden.',
      ),
    APP_COMMIT_SHA: z.string().regex(/^[0-9a-f]{40}$/u),
    POSTGRES_DB: z.string().regex(/^[a-z][a-z0-9_]{2,62}$/u),
    POSTGRES_USER: z.string().regex(/^[a-z][a-z0-9_]{2,62}$/u),
    POSTGRES_PASSWORD: z
      .string()
      .min(20)
      .regex(/^[A-Za-z0-9_-]+$/u, 'Use a URL-safe database password.'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(10),
    SESSION_SECRET: z.string().min(32),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),
    ADMIN_SEED_USERNAME: z
      .union([z.string().regex(/^[a-z0-9._-]{3,50}$/u), z.literal('')])
      .optional(),
    ADMIN_SEED_PASSWORD: z.union([z.string().min(16).max(200), z.literal('')]).optional(),
    ALLOW_PRODUCTION_SEED: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const seedValues = [value.ADMIN_SEED_USERNAME, value.ADMIN_SEED_PASSWORD].filter(Boolean);

    if (seedValues.length === 1) {
      context.addIssue({
        code: 'custom',
        message: 'ADMIN_SEED_USERNAME and ADMIN_SEED_PASSWORD must be configured together.',
      });
    }
  });

const result = schema.safeParse(parse(readFileSync(environmentPath)));

if (!result.success) {
  console.error(`Production environment validation failed for ${environmentPath}:`);
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

console.log(`Production environment contract OK: ${environmentPath}`);
