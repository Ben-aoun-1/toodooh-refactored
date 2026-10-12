import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  businessSectors,
  screenhostPistes,
  screenhostUnavailability,
  screenhosts,
  users,
} from '../src/db/schema.js';
import type { ReportData } from '../src/lib/report/assemble.js';
import type { PlanArgs } from '../src/lib/report/piste02/input.js';
import { ensureMonthPiste02, latestPiste02 } from '../src/lib/report/piste02/store.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// PISTES-V2 — the stored Piste 02 (screenhost_pistes, mig 0083) against a real Postgres. The plan
// and the model call are spied (pinned in piste02-pure / piste02-generate); this file pins what
// the store owns: the venue facts and the history it hands the plan, generate-ONCE-per-month,
// « store nothing » on a failed or skipped generation, and the latest-month read the page uses.

const planSpy = vi.hoisted(() => vi.fn());
const generateSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/report/piste02/input.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/piste02/input.js')>();
  return { ...actual, planPiste02: planSpy };
});
vi.mock('../src/lib/report/piste02/generate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/piste02/generate.js')>();
  return { ...actual, generatePiste02: generateSpy };
});

const RESULT = {
  statut: 'genere' as const,
  titre: 'Le creux du midi',
  corps: 'Corps généré.',
  familleLevier: 'C',
  creneauxCites: ['lundi 12h-13h'],
  hypotheseFormulee: 'Offre inadaptée',
  confiance: 'haute' as const,
  model: 'claude-sonnet-5-5',
};

// The month's ReportData as the job hands it. measuredDays 0 keeps the previous-month read out.
const DATA = {
  range: { from: '2026-06-01', to: '2026-06-30' },
  kpis: { measuredDays: 0 },
} as ReportData;

let seq = 0;
const seedVenue = async (): Promise<string> => {
  seq += 1;
  const [owner] = await db
    .insert(users)
    .values({
      email: `p02-${seq}@example.com`,
      contactName: `Owner ${seq}`,
      role: 'individual_owner',
      status: 'approved',
    })
    .returning();
  // The seeded owner sector (mig 0036) — a real référentiel mapping, Café → Cafés.
  const [sector] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.name, 'Café'))
    .limit(1);
  const [venue] = await db
    .insert(screenhosts)
    .values({
      name: 'Café Le Palmier',
      ownerId: owner?.id ?? '',
      businessSectorId: sector?.id ?? null,
      class: 'moyen',
      city: 'Ariana',
      openingHour: 10,
      closingHour: 23,
    })
    .returning();
  return venue?.id ?? '';
};

const storeRow = (
  venueId: string,
  month: string,
  over: Partial<typeof screenhostPistes.$inferInsert> = {},
) =>
  db
    .insert(screenhostPistes)
    .values({ screenhostId: venueId, month, statut: 'genere', corps: `Corps ${month}`, ...over });

beforeEach(async () => {
  await resetAuthTables();
  planSpy.mockReset();
  generateSpy.mockReset();
  planSpy.mockReturnValue({
    kind: 'generate',
    statut: 'genere',
    consignes: [],
    noPreciseHour: false,
    input: {},
  });
  generateSpy.mockResolvedValue(RESULT);
});

afterAll(async () => {
  await sql.end();
});

describe('ensureMonthPiste02', () => {
  it('generates once, stores the row, and serves the stored row afterwards without a call', async () => {
    const venue = await seedVenue();
    const first = await ensureMonthPiste02(venue, '2026-06', DATA);
    expect(first).toMatchObject({ month: '2026-06', corps: 'Corps généré.', familleLevier: 'C' });
    const again = await ensureMonthPiste02(venue, '2026-06', DATA);
    expect(again?.id).toBe(first?.id);
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it('hands the plan the venue facts, the month’s closures and the 3-month rotation history', async () => {
    const venue = await seedVenue();
    await db.insert(screenhostUnavailability).values([
      { screenhostId: venue, day: '2026-06-14' },
      { screenhostId: venue, day: '2026-07-01' }, // outside the month
    ]);
    await storeRow(venue, '2026-02', {
      familleLevier: 'A',
      titre: 'Titre février',
      creneauxCites: ['jeudi 9h'],
    });
    await storeRow(venue, '2026-03', {
      familleLevier: 'B',
      titre: 'Titre mars',
      creneauxCites: ['mardi 15h'],
    });
    await storeRow(venue, '2026-05', {
      familleLevier: 'D',
      titre: 'Titre mai',
      creneauxCites: ['lundi 12h'],
    });
    await ensureMonthPiste02(venue, '2026-06', DATA);
    const args = planSpy.mock.calls[0]?.[0] as PlanArgs;
    expect(args.month).toBe('2026-06');
    expect(args.facts).toMatchObject({
      venueName: 'Café Le Palmier',
      venueClass: 'moyen',
      city: 'Ariana',
      openingHour: 10,
      closingHour: 23,
      closures: ['2026-06-14'],
    });
    // March + May are inside the 3-month window (≥ 2026-03); February is not.
    expect(args.history.familles.sort()).toEqual(['B', 'D']);
    expect(args.history.creneaux.sort()).toEqual(['lundi 12h', 'mardi 15h']);
    // Titles are never reused, whatever their age.
    expect(args.history.titres.sort()).toEqual(['Titre février', 'Titre mai', 'Titre mars']);
    expect(args.firstReport).toBe(false);
    expect(args.previousGlobal).toBeNull();
  });

  it('a venue without stored piste is a first report', async () => {
    const venue = await seedVenue();
    await ensureMonthPiste02(venue, '2026-06', DATA);
    expect((planSpy.mock.calls[0]?.[0] as PlanArgs).firstReport).toBe(true);
  });

  it('stores NOTHING when the plan skips or the generation fails (the next run retries)', async () => {
    const venue = await seedVenue();
    planSpy.mockReturnValueOnce({ kind: 'skip', reason: 'no_category' });
    await expect(ensureMonthPiste02(venue, '2026-06', DATA)).resolves.toBeNull();
    expect(generateSpy).not.toHaveBeenCalled();
    generateSpy.mockResolvedValueOnce(null);
    await expect(ensureMonthPiste02(venue, '2026-06', DATA)).resolves.toBeNull();
    expect(await db.select().from(screenhostPistes)).toHaveLength(0);
  });
});

describe('latestPiste02', () => {
  it('reads the most recent stored month, null before the first one', async () => {
    const venue = await seedVenue();
    await expect(latestPiste02(venue)).resolves.toBeNull();
    await storeRow(venue, '2026-08');
    await storeRow(venue, '2026-09');
    expect((await latestPiste02(venue))?.corps).toBe('Corps 2026-09');
  });
});
