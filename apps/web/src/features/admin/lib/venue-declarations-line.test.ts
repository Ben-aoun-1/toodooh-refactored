import { describe, expect, it } from 'vitest';

import type { ScreenhostEligibility } from '@/features/admin/services/admin-screenhost.service';

import { venueDeclarationsLine } from './venue-declarations-line';

const base: ScreenhostEligibility = {
  business_sector_id: null,
  class: null,
  opening_hour: 8,
  closing_hour: 22,
  broadcast_capacity: null,
  sps: 50,
};

describe('venueDeclarationsLine (Mariem 11/11)', () => {
  it('prints the Ramadan window and the match answer', () => {
    expect(
      venueDeclarationsLine({
        ...base,
        ramadan_opening_hour: 20,
        ramadan_closing_hour: 2,
        broadcasts_matches: false,
      }),
    ).toBe('Ramadan : 20h → 2h · Diffuse les matchs : Non');
  });

  it('a venue that declared nothing reads « non renseigné »', () => {
    expect(venueDeclarationsLine(base)).toBe(
      'Ramadan : non renseigné · Diffuse les matchs : non renseigné',
    );
    expect(venueDeclarationsLine({ ...base, broadcasts_matches: true })).toBe(
      'Ramadan : non renseigné · Diffuse les matchs : Oui',
    );
  });
});
