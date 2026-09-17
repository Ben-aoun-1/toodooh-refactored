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

// CPM-2 — migration 0075's BACKFILL, proven once against real data: a scratch database is migrated
// to 0074 (a copy of the migrations folder whose journal stops there), seeded with the shapes that
// exist in production, then the real folder is applied. The config T (0.50 / 0.65 / 0.90) matches
// no plan below, so every tier that reads a plan value can only have come from the plan. The
// scratch name is NOT `<main>_sim_…`, so the simulator's orphan sweep never sees it.

const CPM2_IDX = 75;
const dbName = `${mainDatabaseName(env.DATABASE_URL)}_cpm2_${randomBytes(4).toString('hex')}`;
const url = sandboxUrl(env.DATABASE_URL, dbName);

type Tiers = { t10: string; t20: string; t30: string };
const CONFIG: Tiers = { t10: '0.500', t20: '0.650', t30: '0.900' };

describe('migration 0075 — the campaign T backfill (scratch database)', () => {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const ids: Record<string, string> = {};
  let tmp = '';

  const insertCampaign = async (key: string, type: string, eventId: string | null) => {
    const [row] = await client<{ id: string }[]>`
      insert into campaigns (advertiser_id, name, campaign_type, event_id)
      values (${ids['advertiser'] ?? ''}, ${key}, ${type}, ${eventId}) returning id`;
    ids[key] = row?.id ?? '';
  };
  const insertPlan = async (key: string, s: number, t: string) => {
    await client`
      insert into campaign_dispatch_plan (campaign_id, i_cible, cpm, s_spot_seconds, t_tier_coef,
        seuil_diffusable, s_min, g_jour, f_max_seconds, r_min_efficace, couvert, n_min, n_max,
        n_retenus)
      values (${ids[key] ?? ''}, 20000, '15.000', ${s}, ${t}, 1334, '20', '3.3333', 300, 2, 1, 1, 1, 1)`;
  };
  const tiersOf = async (key: string): Promise<Tiers | undefined> => {
    const [row] = await client<Tiers[]>`
      select t_10s::text as t10, t_20s::text as t20, t_30s::text as t30
      from campaigns where id = ${ids[key] ?? ''}`;
    return row;
  };

  beforeAll(async () => {
    await createSandboxDatabase(dbName);
    tmp = migrationsFolderBefore(CPM2_IDX);
    await migrate(drizzle(client), { migrationsFolder: tmp });

    await client`update dispatch_config set t_10s = '0.50', t_20s = '0.65', t_30s = '0.90'`;
    const [adv] = await client<{ id: string }[]>`
      insert into users (email, contact_name) values ('cpm2-backfill@example.com', 'CPM2')
      returning id`;
    ids['advertiser'] = adv?.id ?? '';
    const [ev] = await client<{ id: string }[]>`
      insert into events (name, kickoff_at, ends_at)
      values ('CPM2 match', '2027-06-10T19:00:00Z', '2027-06-10T21:00:00Z') returning id`;

    await insertCampaign('draft', 'standard', null);
    await insertCampaign('s16', 'standard', null);
    await insertPlan('s16', 16, '0.700');
    await insertCampaign('s10', 'standard', null);
    await insertPlan('s10', 10, '0.600');
    await insertCampaign('s26', 'standard', null);
    await insertPlan('s26', 26, '0.800');
    // The bucket edges (S ≤ 10 / ≤ 20 / else), on a legacy event-TYPED classic row: T does not
    // depend on the type.
    await insertCampaign('s20', 'event', null);
    await insertPlan('s20', 20, '0.700');
    await insertCampaign('s11', 'standard', null);
    await insertPlan('s11', 11, '0.700');
    await insertCampaign('positioning', 'event', ev?.id ?? null);

    await applyMigrations(url); // the real folder → applies 0075 (and anything after it)
  }, 300_000);

  afterAll(async () => {
    await client.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropSandboxDatabase(dbName);
  }, 300_000);

  it('a draft without a plan and a positioning keep today’s config on all three tiers', async () => {
    expect(await tiersOf('draft')).toEqual(CONFIG);
    expect(await tiersOf('positioning')).toEqual(CONFIG);
  });

  it('a campaign with a plan takes plan.t_tier_coef on the ONE tier its S falls in', async () => {
    expect(await tiersOf('s16')).toEqual({ ...CONFIG, t20: '0.700' });
    expect(await tiersOf('s10')).toEqual({ ...CONFIG, t10: '0.600' });
    expect(await tiersOf('s26')).toEqual({ ...CONFIG, t30: '0.800' });
    expect(await tiersOf('s20')).toEqual({ ...CONFIG, t20: '0.700' });
    expect(await tiersOf('s11')).toEqual({ ...CONFIG, t20: '0.700' });
  });

  it('the three columns end numeric(4,3) NOT NULL with a STABLE function default', async () => {
    const cols = await client<
      {
        column_name: string;
        is_nullable: string;
        column_default: string;
        numeric_precision: number;
        numeric_scale: number;
      }[]
    >`
      select column_name, is_nullable, column_default, numeric_precision, numeric_scale
      from information_schema.columns
      where table_name = 'campaigns' and column_name in ('t_10s', 't_20s', 't_30s')
      order by column_name`;
    expect(cols).toEqual(
      ['10', '20', '30'].map((s) => ({
        column_name: `t_${s}s`,
        is_nullable: 'NO',
        column_default: `current_t_${s}s()`,
        numeric_precision: 4,
        numeric_scale: 3,
      })),
    );
    const volatility = await client<{ proname: string; provolatile: string }[]>`
      select proname, provolatile from pg_proc
      where proname in ('current_t_10s', 'current_t_20s', 'current_t_30s') order by proname`;
    expect(volatility).toEqual([
      { proname: 'current_t_10s', provolatile: 's' },
      { proname: 'current_t_20s', provolatile: 's' },
      { proname: 'current_t_30s', provolatile: 's' },
    ]);
  });

  it('after a config change a new row captures the new T and existing rows do not move', async () => {
    await client`update dispatch_config set t_10s = '0.55', t_20s = '0.75', t_30s = '0.95'`;
    await insertCampaign('afterMigration', 'standard', null);
    expect(await tiersOf('afterMigration')).toEqual({ t10: '0.550', t20: '0.750', t30: '0.950' });
    expect(await tiersOf('draft')).toEqual(CONFIG);
    expect(await tiersOf('s16')).toEqual({ ...CONFIG, t20: '0.700' });

    // With no config row at all, the functions fall back to the V1 defaults.
    await client`delete from dispatch_config`;
    await insertCampaign('noConfig', 'standard', null);
    expect(await tiersOf('noConfig')).toEqual({ t10: '0.600', t20: '0.700', t30: '0.800' });
  });
});
