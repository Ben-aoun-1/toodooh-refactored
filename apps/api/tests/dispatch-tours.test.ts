import { describe, expect, it } from 'vitest';

import { remplirAvecSeuil } from '../src/lib/dispatch/tours/anti-miette.js';
import {
  type CalculParams,
  calculer,
  couper,
  precalculer,
} from '../src/lib/dispatch/tours/calculer.js';
import { creneauxParVenue } from '../src/lib/dispatch/tours/creneaux.js';
import { buildFile } from '../src/lib/dispatch/tours/file.js';
import { type VenueInput, buildHeuresTypes } from '../src/lib/dispatch/tours/heures-types.js';
import { redistribuer } from '../src/lib/dispatch/tours/redistribuer.js';

// DISP-TOURS — Mariem's worked examples (« Toodooh : dispatching, pricing et redispatching des
// campagnes normales », §2), pinned figure for figure. Period: Monday 9 → Wednesday 18 November
// 2026 (2 Mondays, Tuesdays and Wednesdays; 1 of every other day). F = 600 s, S = 30 s → R_plein
// = 20, T = 0,80, CPM 12 DT, Screenhost share 50 %, SEUIL_SH 30 DT.

const PARAMS: CalculParams = { rPlein: 20, t: 0.8, cpm: 12, pctSh: 50, seuilShTnd: 30 };

const DATES: Record<number, string[]> = {
  1: ['2026-11-09', '2026-11-16'],
  2: ['2026-11-10', '2026-11-17'],
  3: ['2026-11-11', '2026-11-18'],
  4: ['2026-11-12'],
  5: ['2026-11-13'],
  6: ['2026-11-14'],
  7: ['2026-11-15'],
};

/** A venue open 16 h → 19 h every day: `week[d]` = the affluence of 16, 17, 18, 19 h on day d+1. */
const venue = (
  id: string,
  sps: number,
  week: number[][],
  dates: Record<number, string[]> = DATES,
): VenueInput => ({
  id,
  sps,
  hours: week.flatMap((row, d) =>
    row.map((affluence, i) => ({
      dayOfWeek: d + 1,
      hour: 16 + i,
      affluence,
      dates: dates[d + 1] ?? [],
    })),
  ),
});

const CAFE_A_WEEK = [
  [20, 30, 25, 10],
  [20, 25, 30, 15],
  [15, 20, 25, 30],
  [30, 25, 20, 10],
  [20, 30, 35, 25],
  [25, 35, 40, 30],
  [30, 25, 20, 15],
];
const CAFE_B_WEEK = [
  [10, 15, 12, 8],
  [12, 10, 15, 8],
  [8, 12, 15, 10],
  [15, 12, 10, 8],
  [10, 15, 18, 12],
  [12, 18, 20, 15],
  [15, 12, 10, 8],
];
const cafeA = (dates = DATES) => venue('cafe_A', 85, CAFE_A_WEEK, dates);
const cafeB = (dates = DATES) => venue('cafe_B', 70, CAFE_B_WEEK, dates);
/** Café C — open Saturday and Sunday only, 18 h → 19 h (Saturday 10 and 5, Sunday 8 and 4). */
const cafeC = (): VenueInput => ({
  id: 'cafe_C',
  sps: 60,
  hours: [
    { dayOfWeek: 6, hour: 18, affluence: 10, dates: DATES[6] ?? [] },
    { dayOfWeek: 6, hour: 19, affluence: 5, dates: DATES[6] ?? [] },
    { dayOfWeek: 7, hour: 18, affluence: 8, dates: DATES[7] ?? [] },
    { dayOfWeek: 7, hour: 19, affluence: 4, dates: DATES[7] ?? [] },
  ],
});
const POOL = [cafeA(), cafeB(), cafeC()];

const close = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6);

describe('DISP-TOURS — the dictionary (scenario 1)', () => {
  it('values each heure-type n × R_plein × A × T and ranks it inside its day', () => {
    const ht = buildHeuresTypes(cafeA(), PARAMS);
    const at = (day: number, hour: number) =>
      ht.find((h) => h.dayOfWeek === day && h.hour === hour);
    expect(at(1, 17)).toMatchObject({
      dates: ['2026-11-09', '2026-11-16'],
      n: 2,
      affluence: 30,
      rang: 1,
    });
    close(at(1, 17)?.valeurPleine ?? 0, 960);
    expect(at(1, 18)).toMatchObject({ n: 2, affluence: 25, rang: 2 });
    close(at(1, 18)?.valeurPleine ?? 0, 800);
    expect(at(1, 16)).toMatchObject({ rang: 3 });
    close(at(1, 16)?.valeurPleine ?? 0, 640);
    expect(at(1, 19)).toMatchObject({ rang: 4 });
    close(at(1, 19)?.valeurPleine ?? 0, 320);
    // Thursday has ONE date: half a Monday of the same affluence.
    expect(at(4, 16)).toMatchObject({ dates: ['2026-11-12'], n: 1, affluence: 30, rang: 1 });
    close(at(4, 16)?.valeurPleine ?? 0, 480);
  });

  it('scenario 9 — on equal affluence the earliest hours take the first ranks', () => {
    const tied = venue('tie', 50, [[20, 20, 20, 5]], { 1: ['2026-11-09'] });
    const ht = buildHeuresTypes(tied, PARAMS);
    expect(ht.map((h) => [h.hour, h.rang])).toEqual([
      [16, 1],
      [17, 2],
      [18, 3],
      [19, 4],
    ]);
  });

  it('an hour with no usable date, or nobody in it, does not exist', () => {
    const ht = buildHeuresTypes(
      {
        id: 'x',
        sps: 1,
        hours: [
          { dayOfWeek: 1, hour: 10, affluence: 12, dates: [] },
          { dayOfWeek: 1, hour: 11, affluence: 0, dates: ['2026-11-09'] },
          { dayOfWeek: 1, hour: 12, affluence: 7, dates: ['2026-11-09'] },
        ],
      },
      PARAMS,
    );
    expect(ht.map((h) => h.hour)).toEqual([12]);
  });
});

describe('DISP-TOURS — tranches and file (scenario 2)', () => {
  it('builds the tour-1 tranche of Café A from its two peak hours of each day', () => {
    const file = buildFile([{ id: 'cafe_A', sps: 85, heures: buildHeuresTypes(cafeA(), PARAMS) }]);
    const t1 = file[0];
    expect(t1?.tour).toBe(1);
    close(t1?.v ?? 0, 9280);
    // Not necessarily consecutive: Tuesday takes 18 h then 17 h, Wednesday 19 h then 18 h.
    expect(t1?.heures.filter((h) => h.dayOfWeek === 2).map((h) => h.hour)).toEqual([18, 17]);
    expect(t1?.heures.filter((h) => h.dayOfWeek === 3).map((h) => h.hour)).toEqual([19, 18]);
  });

  it('values every tranche, excludes Café C (under 30 DT even full) and orders the file', () => {
    const pre = precalculer(POOL, PARAMS);
    expect([...pre.exclusMax]).toEqual(['cafe_C']);
    expect(pre.file.map((t) => [t.tour, t.venueId])).toEqual([
      [1, 'cafe_A'],
      [1, 'cafe_B'],
      [2, 'cafe_A'],
      [2, 'cafe_B'],
    ]);
    pre.file.forEach((t, i) => close(t.v, [9280, 4592, 5840, 3088][i] ?? 0));
    pre.file.forEach((t, i) => close(t.cum, [9280, 13872, 19712, 22800][i] ?? 0));
    close(pre.iMax, 22800);
    close(pre.cMaxTnd, 273.6);
  });
});

describe('DISP-TOURS — the fill, the price and the anti-miette', () => {
  it('scenario 3 — at the maximum every tranche is whole', () => {
    const r = calculer(POOL, 273.6, PARAMS);
    const a = r.venues.find((v) => v.venueId === 'cafe_A');
    const b = r.venues.find((v) => v.venueId === 'cafe_B');
    close(a?.impressions ?? 0, 15120);
    close(a?.montantTnd ?? 0, 90.72);
    close(b?.impressions ?? 0, 7680);
    close(b?.montantTnd ?? 0, 46.08);
    close(r.prixTnd, 273.6);
    expect(a?.statut).toBe('plein');
    expect(r.venues.find((v) => v.venueId === 'cafe_C')?.statut).toBe('exclu_plein');
    expect(r.verification).toEqual({ objectif: true, prixExact: true, aucunSousSeuil: true });
  });

  it('scenario 4 — 150 DT: Café B under 30 DT is removed, Café A takes tour 2 at 11 passages', () => {
    const r = calculer(POOL, 150, PARAMS);
    close(r.iCible, 12500);
    // The first fill cut Café B's tour-1 tranche at 14 passages: 3 214,4 impressions, 19,29 DT.
    expect(r.final.retires).toHaveLength(1);
    expect(r.final.retires[0]?.venueId).toBe('cafe_B');
    close(r.final.retires[0]?.impressions ?? 0, 3214.4);
    expect(r.final.retires[0]?.montantTnd).toBeCloseTo(19.29, 2);
    const a = r.venues.find((v) => v.venueId === 'cafe_A');
    expect(a?.tours).toEqual([
      { tour: 1, passages: 20 },
      { tour: 2, passages: 11 },
    ]);
    close(r.iAlloue, 12492);
    close(a?.impressions ?? 0, 12492);
    expect(r.prixTnd).toBeCloseTo(149.904, 6); // « 149,90 DT » shown instead of 150 DT
    expect(a?.montantTnd).toBeCloseTo(74.95, 2);
    expect(a?.statut).toBe('retenu');
    expect(r.venues.find((v) => v.venueId === 'cafe_B')?.statut).toBe('retire_budget');
    expect(r.verification).toEqual({ objectif: true, prixExact: true, aucunSousSeuil: true });

    // Monday 16 h (rang 3) airs 11 times an hour on both Mondays: 640 × 11 ÷ 20 = 352 qualified.
    const creneaux = creneauxParVenue(r.final.prises).get('cafe_A') ?? [];
    const mon16 = creneaux.filter(
      (c) => c.hour === 16 && ['2026-11-09', '2026-11-16'].includes(c.date),
    );
    expect(mon16.map((c) => c.reps)).toEqual([11, 11]);
    close(mon16.reduce((sum, c) => sum + c.impressions, 0) * PARAMS.t, 352);
    // Every créneau sums back to the price: physical × T × CPM ÷ 1000.
    close(
      (creneaux.reduce((sum, c) => sum + c.impressions, 0) * PARAMS.t * PARAMS.cpm) / 1000,
      r.prixTnd,
    );
  });

  it('scenario 5 — 200 DT: B removed, A full, no hour left → impressions and price go down', () => {
    const r = calculer(POOL, 200, PARAMS);
    close(r.iCible, 200000 / 12);
    expect(r.final.retires.map((x) => x.venueId)).toEqual(['cafe_B']);
    close(r.final.retires[0]?.montantTnd ?? 0, 27.552);
    close(r.iAlloue, 15120);
    close(r.prixTnd, 181.44);
    expect(r.venues.find((v) => v.venueId === 'cafe_A')?.statut).toBe('plein');
    expect(r.verification.objectif).toBe(true); // no free hour left among the retained
  });

  it('scenario 6 — lowering the cursor = REMPLIR again on the same file: back to scenario 4', () => {
    const pre = precalculer(POOL, PARAMS);
    const atMax = couper(pre, 273.6, PARAMS);
    close(atMax.iAlloue, 22800);
    const lowered = couper(pre, 150, PARAMS);
    close(lowered.iAlloue, 12492);
    close(lowered.prixTnd, calculer(POOL, 150, PARAMS).prixTnd);
  });

  it('a budget too small to give any venue 30 DT places nothing', () => {
    const r = calculer(POOL, 50, PARAMS); // 60 DT HT is the floor at a 50 % share
    expect(r.iAlloue).toBe(0);
    expect(r.prixTnd).toBe(0);
  });

  it('the price never exceeds the budget, whatever the cursor', () => {
    const pre = precalculer(POOL, PARAMS);
    for (let budget = 60; budget <= 280; budget += 7.31) {
      const r = couper(pre, budget, PARAMS);
      expect(r.prixTnd).toBeLessThanOrEqual(budget + 1e-6);
      expect(r.verification.aucunSousSeuil).toBe(true);
      expect(r.verification.prixExact).toBe(true);
    }
  });
});

describe('DISP-TOURS — availability inputs (scenarios 7, 8)', () => {
  it('scenario 7 — a declared day shrinks n: Café A unavailable on Monday 16 November', () => {
    const dates = { ...DATES, 1: ['2026-11-09'] };
    const ht = buildHeuresTypes(cafeA(dates), PARAMS);
    close(ht.find((h) => h.dayOfWeek === 1 && h.hour === 17)?.valeurPleine ?? 0, 480);
    close(ht.find((h) => h.dayOfWeek === 1 && h.hour === 18)?.valeurPleine ?? 0, 400);
    const file = buildFile([{ id: 'cafe_A', sps: 85, heures: ht }]);
    close(file[0]?.v ?? 0, 8400);
  });

  it('scenario 8 — a full hour disappears and the day re-ranks', () => {
    // Saturday 14 November 18 h holds CAP_heure = 6 launched campaigns: no usable date left.
    const a = cafeA();
    const full: VenueInput = {
      ...a,
      hours: a.hours.map((h) => (h.dayOfWeek === 6 && h.hour === 18 ? { ...h, dates: [] } : h)),
    };
    const ht = buildHeuresTypes(full, PARAMS).filter((h) => h.dayOfWeek === 6);
    expect(ht.map((h) => [h.hour, h.rang])).toEqual([
      [17, 1],
      [19, 2],
      [16, 3],
    ]);
    const file = buildFile([{ id: 'cafe_A', sps: 85, heures: buildHeuresTypes(full, PARAMS) }]);
    const sat = file[0]?.heures.filter((h) => h.dayOfWeek === 6) ?? [];
    close(
      sat.reduce((sum, h) => sum + h.valeurPleine, 0),
      1040,
    );
  });
});

describe('DISP-TOURS — redispatching (scenarios 12, 13)', () => {
  const REMAINING: Record<number, string[]> = {
    1: ['2026-11-16'],
    2: ['2026-11-17'],
    3: ['2026-11-11', '2026-11-18'],
    4: ['2026-11-12'],
    5: ['2026-11-13'],
    6: ['2026-11-14'],
    7: ['2026-11-15'],
  };

  it('scenario 12 — a new venue under 30 DT is refused: 1 188 impressions (14,26 DT) stay unplaced', () => {
    // Scenario 4 launched (Café A alone); its screen is off all of Tuesday 10 November.
    // NB her Q3 answer (03/11) puts the redispatch AND refund floors at 30 DT (S_MIN_TOURS_TND):
    // a 14,26 DT loss neither triggers a round nor is refunded at settlement — this pins the
    // placement arithmetic of her scenario only (raised with her).
    const launched = calculer(POOL, 150, PARAMS);
    const a = creneauxParVenue(launched.final.prises).get('cafe_A') ?? [];
    const lost = a.filter((c) => c.date === '2026-11-10');
    const perte = lost.reduce((sum, c) => sum + c.impressions, 0) * PARAMS.t;
    close(perte, 1188); // tour 1 (18 h, 17 h at 20 passages) 880 + tour 2 (16 h, 19 h at 11) 308
    const r = redistribuer({ perte, engages: [], nouveaux: [cafeB(REMAINING)], params: PARAMS });
    expect(r.nouveaux?.retires.map((x) => x.venueId)).toEqual(['cafe_B']);
    close(r.place, 0);
    close(r.nonPlace, 1188);
    close((r.nonPlace * PARAMS.cpm) / 1000, 14.256); // the value left unplaced
  });

  it('scenario 13 — the loss goes to Café B, already in the campaign, on its free peak hours', () => {
    // B already holds the campaign's tour 1 (its rangs 1–2): its free hours are its rangs 3–4,
    // re-ranked among themselves, on the remaining dates only. A, the defaulter, gets nothing.
    const bFree: VenueInput = {
      ...cafeB(REMAINING),
      hours: cafeB(REMAINING).hours.filter((h) => {
        const ranks = buildHeuresTypes(cafeB(), PARAMS);
        return (ranks.find((x) => x.dayOfWeek === h.dayOfWeek && x.hour === h.hour)?.rang ?? 0) > 2;
      }),
    };
    const r = redistribuer({ perte: 1188, engages: [bFree], nouveaux: [], params: PARAMS });
    expect([...r.engages.impressions.keys()]).toEqual(['cafe_B']);
    const placedB = r.engages.impressions.get('cafe_B') ?? 0;
    expect(placedB).toBeLessThanOrEqual(1188);
    // Indivisible passages: what stays unplaced is under one passage of the tranche.
    const tranche = r.engages.prises[0]?.tranche;
    expect(1188 - placedB).toBeLessThan((tranche?.v ?? 0) / PARAMS.rPlein);
    expect(
      r.engages.prises.every((p) =>
        p.tranche.heures.every((h) => h.dates.every((d) => d >= '2026-11-11')),
      ),
    ).toBe(true);
  });

  it('the R11 helper keeps retained venues at or above 30 DT after a refill', () => {
    const pre = precalculer(POOL, PARAMS);
    const r = remplirAvecSeuil(pre.file, 12500, PARAMS);
    for (const imp of r.impressions.values()) expect(imp * 0.006).toBeGreaterThanOrEqual(30);
  });
});
