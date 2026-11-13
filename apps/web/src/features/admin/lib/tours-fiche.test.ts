import { describe, expect, it } from 'vitest';

import type { ToursFicheVenue } from './eligible-hosts';
import { journalLine, statutDetail, toursRecus, weekGrid } from './tours-fiche';

/** fr-FR groups thousands with a narrow no-break space. */
const plain = (s: string): string => s.replace(/[\u202f\u00a0]/g, ' ');

const venue = (over: Partial<ToursFicheVenue> = {}): ToursFicheVenue => ({
  id: 'a',
  name: 'Café A',
  sector: 'Café',
  class: 'moyen',
  sps: 85,
  ordre: 1,
  plein_impressions: 15120,
  plein_montant_tnd: 90.72,
  impressions: 12492,
  montant_tnd: 74.95,
  statut: 'retenu',
  tours: [
    { tour: 1, passages: 20 },
    { tour: 2, passages: 11 },
  ],
  week: [
    { day_of_week: 1, hour: 17, affluence: 30, n: 2, tour: 1, passages: 20 },
    { day_of_week: 1, hour: 16, affluence: 20, n: 2, tour: 2, passages: 11 },
    { day_of_week: 4, hour: 16, affluence: 30, n: 1, tour: 1, passages: 20 },
    { day_of_week: 6, hour: 18, affluence: 40, n: 0, tour: null, passages: null },
  ],
  ...over,
});

describe('DISP-TOURS — the admin fiche texts', () => {
  it('« Tours reçus » names the partial tranche and its passages', () => {
    expect(toursRecus(venue().tours, 20)).toBe('1, 2 partiel (11 passages)');
    expect(toursRecus([], 20)).toBe('—');
  });

  it('the week grid puts weekdays in columns with their dates, hours in rows', () => {
    const grid = weekGrid(venue());
    expect(grid.days.map((d) => d.label)).toEqual(['Lun ×2', 'Jeu ×1', 'Sam']);
    expect(grid.hours).toEqual([16, 17, 18]);
    expect(grid.cell(1, 17)).toMatchObject({ tour: 1, passages: 20 });
    expect(grid.cell(6, 18)?.n).toBe(0); // full / unavailable: greyed
  });

  it('explains the two 30 TND statuses', () => {
    expect(statutDetail(venue({ statut: 'retire_budget' }))).toContain('au budget choisi');
    expect(
      plain(statutDetail(venue({ statut: 'exclu_plein', plein_montant_tnd: 2.59 })) ?? ''),
    ).toContain('2,59 TND');
    expect(statutDetail(venue())).toBeNull();
  });

  it('writes one journal line per phase', () => {
    expect(
      plain(
        journalLine({
          phase: 'remplissage',
          result: { iCible: 12500, trancheCoupure: 2, k: 14 },
          ms: 1,
        }).text,
      ),
    ).toBe('Objectif 12 500 impressions · coupure à la tranche n° 2, 14 passages/h.');
    expect(
      journalLine({
        phase: 'verification',
        result: { objectif: true, prixExact: true, aucunSousSeuil: false },
        ms: 0,
      }).text,
    ).toBe('Objectif : OK · prix exact : OK · aucun host sous 30 TND : échec.');
  });
});
