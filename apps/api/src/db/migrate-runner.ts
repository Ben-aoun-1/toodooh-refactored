import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// The ONE migrator call. scripts/migrate.ts (container start) and the simulator's sandbox
// provisioning both apply the same folder the same way. The folder resolves relative to this
// file (src/db → ../../drizzle; dist/db → ../../drizzle — the image copies both `dist` and
// `drizzle` under /app), so it does not depend on the process cwd.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

export const applyMigrations = async (databaseUrl: string): Promise<void> => {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
};
