import { describe, expect, it } from 'vitest';

import type { BusinessSector } from '@/features/auth/types/auth';

import {
  filterAdvertiserAgencySectorsByDbOrder,
  sectorsForAdvertiserAgencySignup,
  sectorsForAdvertiserProfile,
} from './advertiserBusinessSectors';

const sector = (name: string, display_order: number | null, id = name): BusinessSector => ({
  id,
  name,
  display_order,
});

// DEAD-SECTORS1 — the owner/advertiser split is the api's `audience` discriminator
// (`/business-sectors?audience=advertiser|owner`), consumed by authService.getBusinessSectors /
// getOwnerBusinessSectors. The retired name-list fallback (« Cafés populaires », « Bars »…) named
// sectors that exist in NO business_sectors row, so it could never filter anything real.
describe('advertiser sector lists — the audience filter is the only discriminator', () => {
  const ordered = [sector('Automobile et mobilité', 2), sector('Agriculture', 1)];

  it('display_order ≥ 1 rows are the strict list, in api order', () => {
    expect(filterAdvertiserAgencySectorsByDbOrder(ordered).map((s) => s.name)).toEqual([
      'Automobile et mobilité',
      'Agriculture',
    ]);
    expect(sectorsForAdvertiserAgencySignup(ordered)).toEqual(ordered);
  });

  it('without display_order, the api list is served AS IS — no name-based exclusion survives', () => {
    // These are the REAL stored owner names; they only ever reach this function if the caller
    // asked for them (audience=owner). Nothing here may second-guess the api's audience answer.
    const fromApi = [
      sector('Café', null),
      sector('Resto/Bar', null),
      sector('Salle de sport', null),
      sector('Bars', null), // one of the retired list's names — no longer dropped
    ];
    expect(sectorsForAdvertiserAgencySignup(fromApi)).toEqual(fromApi);
  });

  it('profile: same list + the historic sector when it is no longer offered', () => {
    const legacy = sector('Ancien secteur', null, 'legacy');
    const options = sectorsForAdvertiserProfile([...ordered, legacy], 'legacy');
    expect(options.map((s) => s.id)).toEqual(['Automobile et mobilité', 'Agriculture', 'legacy']);
    expect(sectorsForAdvertiserProfile(ordered, 'Agriculture')).toEqual(ordered);
    expect(sectorsForAdvertiserProfile(ordered, null)).toEqual(ordered);
  });
});
