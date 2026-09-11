// Runs ONCE in the vitest main process before any worker starts (see parallel-db.ts).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import {
  baseDatabaseUrl,
  maintenanceUrl,
  templateDatabaseName,
  workerCount,
  workerDatabaseName,
} from './parallel-db.js';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const templateUrl = (base: string, tpl: string): string => {
  const url = new URL(base);
  url.pathname = `/${tpl}`;
  return url.toString();
};

export default async function setup(): Promise<void> {
  const base = baseDatabaseUrl();
  const baseName = new URL(base).pathname.replace(/^\//, '');
  const workers = workerCount();

  const tpl = templateDatabaseName(baseName);
  const admin = postgres(maintenanceUrl(base), { max: 1 });
  try {
    // 1. A FRESH template, migrated from 0000 — the same call scripts/migrate.ts makes, on a
    //    database nothing else has touched. WITH (FORCE) evicts a stale connection from an
    //    aborted earlier run (Postgres ≥ 13).
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(tpl)} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${quoteIdent(tpl)}`);
    const migrator = postgres(templateUrl(base, tpl), { max: 1 });
    try {
      await migrate(drizzle(migrator), { migrationsFolder });
    } finally {
      await migrator.end(); // CREATE DATABASE … TEMPLATE needs the template connection-free
    }

    // 2. One private copy per worker.
    for (let i = 1; i <= workers; i += 1) {
      const name = quoteIdent(workerDatabaseName(baseName, i));
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${quoteIdent(tpl)}`);
    }
  } finally {
    await admin.end();
  }
  process.stdout.write(`[parallel-db] ${workers} worker database(s) cloned from ${tpl}\n`);
}
