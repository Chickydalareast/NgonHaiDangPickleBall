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
    SESSION_SECRET: z.string().min(32),
    WEB_ORIGIN: z.url(),
    CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535),
  })
  .strict();

const result = environmentSchema.safeParse(rawEnvironment);

if (!result.success) {
  console.error(`Environment validation failed for ${envFile}:`);
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

console.log(`Environment contract OK: ${envFile}`);
