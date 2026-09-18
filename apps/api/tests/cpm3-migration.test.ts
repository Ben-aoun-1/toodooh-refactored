import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from '../src/db/migrate-runner.js';
import { env } from '../src/env.js';
import { mainDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';

import { migrationsFolderBefore } from './helpers/migrations-before.js';

// CPM-3 — migration 0076 proven on a scratch database migrated to 0075 with the production shape
// of 2026-09-17: config 10 / 15, a draft restored to 15 by CPM-1. The scratch name is not
// `<main>_sim_…`, so the simulator's orphan sweep never sees it; it is dropped in afterAll.

const CPM3_IDX = 76;
const dbName = `${mainDatabaseName(env.DATABASE_URL)}_cpm3_${randomBytes(4).toString('hex')}`;
const url = sandboxUrl(env.DATABASE_URL, dbName);

type Rates = { standard: string; event: string };

describe('migration 0076 — the CPM per screencaster (scratch database)', () => {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const ids: Record<string, string> = {};
  let tmp = '';

  const insertCampaign = async (key: string, advertiser: string, rates?: Rates) => {
    const [row] = rates
      ? await client<{ id: string }[]>`
          insert into campaigns (advertiser_id, name, campaign_type, standard_cpm_tnd, event_cpm_tnd)
          values (${advertiser}, ${key}, 'standard', ${rates.standard}, ${rates.event}) returning id`
      : await client<{ id: string }[]>`
          insert into campaigns (advertiser_id, name, campaign_type)
          values (${advertiser}, ${key}, 'standard') returning id`;
    ids[key] = row?.id ?? '';
  };
  const campaignRates = async (key: string): Promise<Rates | undefined> => {
    const [row] = await client<Rates[]>`
      select standard_cpm_tnd::text as standard, event_cpm_tnd::text as event
      from campaigns where id = ${ids[key] ?? ''}`;
    return row;
  };
  const userRates = async (id: string): Promise<Rates | undefined> => {
    const [row] = await client<Rates[]>`
      select cpm_standard_tnd::text as standard, cpm_event_tnd::text as event
      from users where id = ${id}`;
    return row;
  };
  const insertUser = async (key: string) => {
    const [u] = await client<{ id: string }[]>`
      insert into users (email, contact_name) values (${`${key}@example.com`}, ${key}) returning id`;
    ids[key] = u?.id ?? '';
  };

  beforeAll(async () => {
    await createSandboxDatabase(dbName);
    tmp = migrationsFolderBefore(CPM3_IDX);
    await migrate(drizzle(client), { migrationsFolder: tmp });
    await client`update dispatch_config set standard_cpm_tnd = '10.000', event_cpm_tnd = '15.000'`;
    await insertUser('advertiser');
    // A draft restored by CPM-1 to its creation CPM (15) while the config says 10.
    await insertCampaign('restoredDraft', ids['advertiser'] ?? '', {
      standard: '15.000',
      event: '15.000',
    });
    await applyMigrations(url); // the real folder → applies 0076
  }, 300_000);

  afterAll(async () => {
    await client.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropSandboxDatabase(dbName);
  }, 300_000);

  it('every existing account is backfilled with the global CPM in force', async () => {
    expect(await userRates(ids['advertiser'] ?? '')).toEqual({
      standard: '10.000',
      event: '15.000',
    });
  });

  it('existing drafts keep their CPM (Q1)', async () => {
    expect(await campaignRates('restoredDraft')).toEqual({ standard: '15.000', event: '15.000' });
  });

  it('a new campaign captures its screencaster’s CPM through the trigger', async () => {
    await client`update users set cpm_standard_tnd = '12.500', cpm_event_tnd = '22.000'
      where id = ${ids['advertiser'] ?? ''}`;
    await insertCampaign('afterChange', ids['advertiser'] ?? '');
    expect(await campaignRates('afterChange')).toEqual({ standard: '12.500', event: '22.000' });
    expect(await campaignRates('restoredDraft')).toEqual({ standard: '15.000', event: '15.000' });
  });

  it('an explicit value still wins over the trigger', async () => {
    await insertCampaign('explicit', ids['advertiser'] ?? '', {
      standard: '9.000',
      event: '19.000',
    });
    expect(await campaignRates('explicit')).toEqual({ standard: '9.000', event: '19.000' });
  });

  it('the global CPM is only the default of NEW accounts', async () => {
    await client`update dispatch_config set standard_cpm_tnd = '11.000', event_cpm_tnd = '16.000'`;
    expect(await userRates(ids['advertiser'] ?? '')).toEqual({
      standard: '12.500',
      event: '22.000',
    });
    await insertUser('newcomer');
    expect(await userRates(ids['newcomer'] ?? '')).toEqual({ standard: '11.000', event: '16.000' });
  });

  it('the campaign columns have no default any more; the trail table exists', async () => {
    const cols = await client<{ column_name: string; column_default: string | null }[]>`
      select column_name, column_default from information_schema.columns
      where table_name = 'campaigns' and column_name in ('standard_cpm_tnd', 'event_cpm_tnd')
      order by column_name`;
    expect(cols).toEqual([
      { column_name: 'event_cpm_tnd', column_default: null },
      { column_name: 'standard_cpm_tnd', column_default: null },
    ]);
    const [trail] = await client<{ n: number }[]>`
      select count(*)::int as n from information_schema.tables
      where table_name = 'screencaster_cpm_changes'`;
    expect(trail?.n).toBe(1);
  });
});
