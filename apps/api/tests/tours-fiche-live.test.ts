import { describe, expect, it } from 'vitest';

import { type ToursFicheWire } from '../src/lib/campaign-eligible-hosts-tours.js';
import { withLiveAllocations } from '../src/lib/dispatch/tours/fiche-live.js';

// Mariem 16/11 — the admin fiche (week grid, shares) of a launched campaign shows its allocations
// as they are now: a refused Host emptied, a Host that took more, a new Host from a redispatch.

const venue = (id: string, impressions: number): ToursFicheWire['venues'][number] => ({
  id,
  name: id,
  sector: null,
  class: null,
  sps: 1,
  ordre: 1,
  plein_impressions: 20000,
  plein_montant_tnd: 100,
  impressions,
  montant_tnd: 0,
  statut: impressions > 0 ? 'retenu' : 'retire_budget',
  tours: [],
  week: [
    {
      day_of_week: 2,
      hour: 10,
      affluence: 10,
      n: 1,
      tour: impressions > 0 ? 1 : null,
      passages: 33,
    },
    { day_of_week: 2, hour: 11, affluence: 12, n: 1, tour: null, passages: null },
  ],
});

const fiche = (): ToursFicheWire => ({
  source: 'plan',
  computed_at: '2026-11-16T16:54:42Z',
  params: {
    f_max_seconds: 600,
    s: 18,
    r_plein: 33,
    t: 0.7,
    cpm: 10,
    pct_sh: 50,
    seuil_sh_tnd: 30,
    cap_heure: 3,
  },
  budget_tnd: 577,
  i_cible: 57800,
  i_max: 100000,
  c_max_tnd: 1000,
  i_alloue: 57706,
  prix_tnd: 577,
  venues: [venue('resto', 17995), venue('toodooh', 7669), venue('amine', 0)],
  journal: [],
});

const names = (id: string) => ({ name: id, sector: null, class: null });

describe('withLiveAllocations', () => {
  it('a Host withdrawn without an answer reads « SANS_REPONSE », not a refusal', () => {
    const live = withLiveAllocations(
      fiche(),
      [
        {
          screenhostId: 'resto',
          statut: 'REFUSE',
          decidedBy: 'system',
          impressions: 1,
          revenuTnd: 1,
          creneaux: [],
        },
      ],
      names,
    );
    expect(live.venues.find((v) => v.id === 'resto')?.reponse).toBe('SANS_REPONSE');
  });

  it('a refused Host is emptied; a Host that took more shows its new hours; a new Host appears', () => {
    // 2026-11-17 is a Tuesday (ISO 2).
    const live = withLiveAllocations(
      fiche(),
      [
        {
          screenhostId: 'resto',
          statut: 'REFUSE',
          impressions: 17995,
          revenuTnd: 179.95,
          creneaux: [],
        },
        {
          screenhostId: 'toodooh',
          statut: 'ACCEPTE',
          impressions: 11019,
          revenuTnd: 110.19,
          creneaux: [
            { date: '2026-11-17', hour: 10, reps: 33, impressions: 330, tour: 1 },
            { date: '2026-11-17', hour: 11, reps: 33, impressions: 396, tour: 2 },
          ],
        },
        {
          screenhostId: 'amine',
          statut: 'EN_ATTENTE',
          impressions: 7184,
          revenuTnd: 71.84,
          creneaux: [{ date: '2026-11-17', hour: 11, reps: 20, impressions: 240, tour: 1 }],
        },
        {
          screenhostId: 'new-host',
          statut: 'EN_ATTENTE',
          impressions: 500,
          revenuTnd: 5,
          creneaux: [{ date: '2026-11-18', hour: 9, reps: 10, impressions: 80, tour: 1 }],
        },
      ],
      names,
    );
    const by = new Map(live.venues.map((v) => [v.id, v]));
    expect(by.get('resto')?.impressions).toBe(0);
    expect(by.get('resto')?.reponse).toBe('REFUSE');
    expect(by.get('toodooh')?.reponse).toBe('ACCEPTE');
    expect(by.get('toodooh')?.tours).toEqual([
      { tour: 1, passages: 33 },
      { tour: 2, passages: 33 },
    ]);
    expect(by.get('amine')?.reponse).toBe('EN_ATTENTE');
    expect(by.get('resto')?.week.every((c) => c.tour === null)).toBe(true);
    expect(by.get('toodooh')?.impressions).toBe(11019);
    expect(by.get('toodooh')?.montant_tnd).toBeCloseTo(55.095, 4);
    expect(by.get('toodooh')?.week.filter((c) => c.tour !== null)).toHaveLength(2);
    expect(by.get('amine')?.statut).toBe('retenu');
    expect(by.get('amine')?.week.find((c) => c.hour === 11)?.passages).toBe(20);
    expect(by.get('new-host')?.week).toEqual([
      { day_of_week: 3, hour: 9, affluence: 8, n: 1, tour: 1, passages: 10 },
    ]);
    expect(live.i_alloue).toBe(11019 + 7184 + 500);
  });

  it('Mariem 17/11 — a match created after the launch marks the hours it cuts', () => {
    const live = withLiveAllocations(
      fiche(),
      [
        {
          screenhostId: 'toodooh',
          statut: 'ACCEPTE',
          impressions: 1056,
          revenuTnd: 10.56,
          creneaux: [
            // Two Tuesdays at 10 h; the match window covers the first only. 11 h is untouched.
            { date: '2026-11-17', hour: 10, reps: 33, impressions: 330, tour: 1 },
            { date: '2026-11-24', hour: 10, reps: 33, impressions: 330, tour: 1 },
            { date: '2026-11-17', hour: 11, reps: 33, impressions: 396, tour: 2 },
          ],
        },
      ],
      names,
      new Map([['toodooh', new Map([['2026-11-17:10', 60]])]]),
    );
    const week = live.venues.find((v) => v.id === 'toodooh')?.week ?? [];
    expect(week.find((c) => c.hour === 10)).toMatchObject({ n: 2, match: 1 });
    expect(week.find((c) => c.hour === 11)?.match).toBeUndefined();
    // A venue without a cut map is unchanged.
    expect(live.venues.find((v) => v.id === 'resto')?.week.some((c) => c.match)).toBe(false);
  });
});
