import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from '../src/db/migrate-runner.js';
import { env } from '../src/env.js';
import { mainDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';

import { migrationsFolderBefore } from './helpers/migrations-before.js';

// SCR-DECL1 — migration 0078 proven on a scratch database migrated to 0077 and seeded with the
// four shapes the D4 backfill (ruled Q6) must tell apart. The scratch name is not `<main>_sim_…`,
// so the simulator's orphan sweep never sees it; it is dropped in afterAll.

const SCR_DECL1_IDX = 77;
const dbName = `${mainDatabaseName(env.DATABASE_URL)}_scrdecl1_${randomBytes(4).toString('hex')}`;
const url = sandboxUrl(env.DATABASE_URL, dbName);
const MIGRATION_0078 = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../drizzle/0078_screen_declaration.sql',
);

interface Declared {
  screen_count: number;
  room_count: number | null;
}

describe('migration 0078 — room_count + the lost screen declarations (scratch database)', () => {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const venues: Record<string, string> = {};
  let tmp = '';

  const declared = async (key: string): Promise<Declared | undefined> => {
    const [row] = await client<Declared[]>`
      select screen_count, room_count from screenhosts where id = ${venues[key] ?? ''}`;
    return row;
  };

  beforeAll(async () => {
    await createSandboxDatabase(dbName);
    tmp = migrationsFolderBefore(SCR_DECL1_IDX);
    await migrate(drizzle(client), { migrationsFolder: tmp });
    const [owner] = await client<{ id: string }[]>`
      insert into users (email, contact_name, role, status)
      values ('owner@example.com', 'Owner', 'individual_owner', 'approved') returning id`;
    const seedVenue = async (key: string, screenCount: number, rows: number) => {
      const [venue] = await client<{ id: string }[]>`
        insert into screenhosts (name, owner_id, screen_count)
        values (${key}, ${owner?.id ?? ''}, ${screenCount}) returning id`;
      venues[key] = venue?.id ?? '';
      for (let i = 1; i <= rows; i += 1) {
        await client`insert into screens (screenhost_id, name) values (${venue?.id ?? ''}, ${`Écran ${i}`})`;
      }
    };
    await seedVenue('selfHealed', 0, 1); // the individual owner whose TV self-healed « Écran 1 »
    await seedVenue('adminRows', 0, 2); // declared 0, two rows exist
    await seedVenue('noRows', 0, 0); // nothing survives → stays 0 (« Non déclaré »)
    await seedVenue('declared', 3, 1); // a real declaration is never overwritten
    await applyMigrations(url); // the real folder → applies 0078
  }, 300_000);

  afterAll(async () => {
    await client.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropSandboxDatabase(dbName);
  }, 300_000);

  it('0 declared + rows → the row count (the only surviving source)', async () => {
    expect(await declared('selfHealed')).toEqual({ screen_count: 1, room_count: null });
    expect(await declared('adminRows')).toEqual({ screen_count: 2, room_count: null });
  });

  it('0 declared + no rows → stays 0', async () => {
    expect(await declared('noRows')).toEqual({ screen_count: 0, room_count: null });
  });

  it('a declaration above 0 is untouched, even when it disagrees with the rows', async () => {
    expect(await declared('declared')).toEqual({ screen_count: 3, room_count: null });
  });

  it('the backfill is idempotent — running its statement again changes nothing', async () => {
    const statements = readFileSync(MIGRATION_0078, 'utf8').split('--> statement-breakpoint');
    const backfill = statements[statements.length - 1] ?? '';
    expect(backfill).toContain('UPDATE "screenhosts"');
    const result = await client.unsafe(backfill);
    expect(result.count).toBe(0);
  });

  it('room_count is a nullable integer that refuses a negative value', async () => {
    const [col] = await client<{ data_type: string; is_nullable: string }[]>`
      select data_type, is_nullable from information_schema.columns
      where table_name = 'screenhosts' and column_name = 'room_count'`;
    expect(col).toEqual({ data_type: 'integer', is_nullable: 'YES' });
    await client`update screenhosts set room_count = 2 where id = ${venues['declared'] ?? ''}`;
    expect(await declared('declared')).toEqual({ screen_count: 3, room_count: 2 });
    await expect(
      client`update screenhosts set room_count = -1 where id = ${venues['declared'] ?? ''}`,
    ).rejects.toThrow(/screenhosts_room_count_nonneg/);
  });
});
