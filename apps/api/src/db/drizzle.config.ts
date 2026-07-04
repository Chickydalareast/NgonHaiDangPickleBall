import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadEnvironmentFile } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const rootEnvironmentPath = resolve(process.cwd(), '../../.env');

if (existsSync(rootEnvironmentPath)) {
  loadEnvironmentFile({ path: rootEnvironmentPath, quiet: true });
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://nhdp:nhdp_local_password@localhost:5432/nhdp',
  },
  strict: true,
  verbose: true,
});
