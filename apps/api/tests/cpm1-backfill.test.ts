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

// CPM-1 — migration 0074's BACKFILL, proven once against real data: a scratch database is migrated
// to 0073 (a copy of the migrations folder whose journal stops there), seeded with the shapes that
// exist in production, then 0074 is applied by the real migrator. The scratch name is NOT
// `<main>_sim_…`, so the simulator's orphan sweep never sees it; it is dropped in afterAll.

const CPM1_IDX = 74;
const dbName = `${mainDatabaseName(env.DATABASE_URL)}_cpm1_${randomBytes(4).toString('hex')}`;
const url = sandboxUrl(env.DATABASE_URL, dbName);

type Rates = { standard: string; event: string };

describe('migration 0074 — the campaign CPM backfill (scratch database)', () => {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const ids: Record<string, string> = {};
  let tmp = '';

  const insertCampaign = async (key: string, type: string, eventId: string | null) => {
    const [row] = await client<{ id: string }[]>`
      insert into campaigns (advertiser_id, name, campaign_type, event_id)
      values (${ids['advertiser'] ?? ''}, ${key}, ${type}, ${eventId}) returning id`;
    ids[key] = row?.id ?? '';
  };
  const insertPlan = async (key: string, cpm: string) => {
    await client`
      insert into campaign_dispatch_plan (campaign_id, i_cible, cpm, s_spot_seconds, t_tier_coef,
        seuil_diffusable, s_min, g_jour, f_max_seconds, r_min_efficace, couvert, n_min, n_max,
        n_retenus)
      values (${ids[key] ?? ''}, 20000, ${cpm}, 10, '0.600', 1334, '20', '3.3333', 300, 2, 1, 1, 1, 1)`;
  };
  const insertAllocation = async (key: string, venue: string, blocs: number, montant: string) => {
    const placed = Array.from({ length: blocs }, (_, i) => ({
      start: new Date(Date.UTC(2027, 5, 10, 18, i * 20)).toISOString(),
      end: new Date(Date.UTC(2027, 5, 10, 18, (i + 1) * 20)).toISOString(),
      impressions: 2000,
    }));
    await client`
      insert into event_allocations (campaign_id, screenhost_id, blocs, impressions_total, montant_tnd)
      values (${ids[key] ?? ''}, ${ids[venue] ?? ''}, ${JSON.stringify(placed)}::jsonb,
        ${blocs * 2000}, ${montant})`;
  };
  const ratesOf = async (key: string): Promise<Rates | undefined> => {
    const [row] = await client<Rates[]>`
      select standard_cpm_tnd::text as standard, event_cpm_tnd::text as event
      from campaigns where id = ${ids[key] ?? ''}`;
    return row;
  };

  beforeAll(async () => {
    await createSandboxDatabase(dbName);
    tmp = migrationsFolderBefore(CPM1_IDX);
    await migrate(drizzle(client), { migrationsFolder: tmp });

    // The config the backfill reads: neither CPM matches any plan below.
    await client`update dispatch_config set standard_cpm_tnd = '20.000', event_cpm_tnd = '25.000'`;
    const [adv] = await client<{ id: string }[]>`
      insert into users (email, contact_name) values ('cpm1-backfill@example.com', 'CPM1')
      returning id`;
    ids['advertiser'] = adv?.id ?? '';
    for (const venue of ['venueA', 'venueB', 'venueC']) {
      const [sh] = await client<{ id: string }[]>`
        insert into screenhosts (name) values (${venue}) returning id`;
      ids[venue] = sh?.id ?? '';
    }
    const [ev] = await client<{ id: string }[]>`
      insert into events (name, kickoff_at, ends_at)
      values ('CPM1 match', '2027-06-10T19:00:00Z', '2027-06-10T21:00:00Z') returning id`;
    const eventId = ev?.id ?? '';

    await insertCampaign('draft', 'standard', null);
    await insertCampaign('classic', 'standard', null);
    await insertPlan('classic', '15.000');
    await insertCampaign('legacyEvent', 'event', null);
    await insertPlan('legacyEvent', '30.000');
    // Operator ruling 2B (2026-09-17): a positioning's event CPM is the PLAIN ratio
    // round(Σ montant × 1000 / Σ impressions_total, 3) — overshoot included, no config test.
    // Dispatched at 15; one venue fully charged (12 000 imp → 180.000), the last one overshooting
    // its final bloc (8 000 placed, 6 666 charged → 99.990).
    await insertCampaign('positionedChanged', 'event', eventId);
    await insertAllocation('positionedChanged', 'venueA', 6, '180.000');
    await insertAllocation('positionedChanged', 'venueB', 4, '99.990');
    // Dispatched at today's 25 with an overshooting fill (budget 90 → 2 blocs placed = 4 000).
    await insertCampaign('positionedUnchanged', 'event', eventId);
    await insertAllocation('positionedUnchanged', 'venueC', 2, '90.000');
    await insertCampaign('positionedEmpty', 'event', eventId);
    // Only a zero-impression allocation: the ratio is undefined, so the config stays.
    await insertCampaign('positionedZero', 'event', eventId);
    await insertAllocation('positionedZero', 'venueA', 0, '0.000');

    await applyMigrations(url); // the real folder → applies 0074 only
  }, 300_000);

  afterAll(async () => {
    await client.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropSandboxDatabase(dbName);
  }, 300_000);

  it('a draft without a plan keeps today’s config (no CPM history exists)', async () => {
    expect(await ratesOf('draft')).toEqual({ standard: '20.000', event: '25.000' });
  });

  it('a classic campaign with a plan takes plan.cpm on the rate its type priced at', async () => {
    expect(await ratesOf('classic')).toEqual({ standard: '15.000', event: '25.000' });
    expect(await ratesOf('legacyEvent')).toEqual({ standard: '20.000', event: '30.000' });
  });

  it('a positioning with allocations takes the plain ratio Σ montant × 1000 / Σ impressions (ruling 2B)', async () => {
    // (180 + 99.99) × 1000 / 20 000 = 13.9995 → 14.000; 90 × 1000 / 4 000 = 22.500.
    expect(await ratesOf('positionedChanged')).toEqual({ standard: '20.000', event: '14.000' });
    expect(await ratesOf('positionedUnchanged')).toEqual({ standard: '20.000', event: '22.500' });
  });

  it('a positioning without allocations, or with zero impressions in total, keeps today’s config', async () => {
    expect(await ratesOf('positionedEmpty')).toEqual({ standard: '20.000', event: '25.000' });
    expect(await ratesOf('positionedZero')).toEqual({ standard: '20.000', event: '25.000' });
  });

  it('both columns end NOT NULL with a function default that captures the config at insert', async () => {
    const cols = await client<
      { column_name: string; is_nullable: string; column_default: string }[]
    >`
      select column_name, is_nullable, column_default from information_schema.columns
      where table_name = 'campaigns' and column_name in ('standard_cpm_tnd', 'event_cpm_tnd')
      order by column_name`;
    expect(cols).toEqual([
      {
        column_name: 'event_cpm_tnd',
        is_nullable: 'NO',
        column_default: 'current_event_cpm_tnd()',
      },
      {
        column_name: 'standard_cpm_tnd',
        is_nullable: 'NO',
        column_default: 'current_standard_cpm_tnd()',
      },
    ]);
    const volatility = await client<{ proname: string; provolatile: string }[]>`
      select proname, provolatile from pg_proc
      where proname in ('current_standard_cpm_tnd', 'current_event_cpm_tnd') order by proname`;
    expect(volatility.map((f) => f.provolatile)).toEqual(['s', 's']); // STABLE

    await client`update dispatch_config set standard_cpm_tnd = '21.000', event_cpm_tnd = '31.000'`;
    await insertCampaign('afterMigration', 'standard', null);
    expect(await ratesOf('afterMigration')).toEqual({ standard: '21.000', event: '31.000' });
    expect(await ratesOf('classic')).toEqual({ standard: '15.000', event: '25.000' });
  });
});
