import { applyMigrations } from '../src/db/migrate-runner.js';
import { env } from '../src/env.js';

const run = async (): Promise<void> => {
  await applyMigrations(env.DATABASE_URL);
  console.info('migrations applied');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migration failed', err);
    process.exit(1);
  });
