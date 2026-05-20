import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '../src/env.js';

const run = async (): Promise<void> => {
  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: 'drizzle' });
    console.info('migrations applied');
  } finally {
    await migrationClient.end();
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migration failed', err);
    process.exit(1);
  });
