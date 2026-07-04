import { existsSync, readFileSync } from 'node:fs';

import { parse } from 'dotenv';
import { z } from 'zod';

const envFile = existsSync('.env') ? '.env' : '.env.example';
const rawEnvironment = parse(readFileSync(envFile));

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    API_HOST: z.string().min(1),
    API_PORT: z.coerce.number().int().min(1).max(65_535),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    POSTGRES_DB: z.string().min(1),
    POSTGRES_USER: z.string().min(1),
    POSTGRES_PASSWORD: z.string().min(12),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: z
      .url()
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL must use the postgresql:// or postgres:// protocol',
      ),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20),
    ADMIN_SEED_USERNAME: z.string().regex(/^[a-z0-9._-]{3,50}$/),
    ADMIN_SEED_PASSWORD: z.string().min(16).max(200),
    SESSION_SECRET: z.string().min(32),
    WEB_ORIGIN: z.url(),
    CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const configured = [
      value.CLOUDINARY_CLOUD_NAME,
      value.CLOUDINARY_API_KEY,
      value.CLOUDINARY_API_SECRET,
    ].filter((item) => typeof item === 'string' && item.trim().length > 0);

    if (configured.length !== 0 && configured.length !== 3) {
      context.addIssue({
        code: 'custom',
        message: 'Cloudinary credentials must be configured together.',
      });
    }
  });

const result = environmentSchema.safeParse(rawEnvironment);

if (!result.success) {
  console.error(`Environment validation failed for ${envFile}:`);
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

console.log(`Environment contract OK: ${envFile}`);
