import { db } from '../../src/db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  users,
} from '../../src/db/schema.js';

// CAP-F1 (operator ruling 2026-09-24) — F (300 s/hour) is a PER-CAMPAIGN cap; the only SHARED
// limit of a screen is the physical hour, 3600 s. One campaign can therefore no longer saturate a
// screen. A test that needs a nearly full screen (to force a saturated / too-thin outcome) fills
// it with this ACTIVE filler campaign first, over a window that overlaps any test window:
//
//   await seedScreenFiller(venueId); // 3300 s held → only one campaign's F (300 s) is left
//
// The filler is a whole engagement row set (user, campaign, frozen plan, ACCEPTE allocation), so
// every pool reader — dispatch, C_max, the cascade, the boost — nets it exactly like a real one.
let seq = 0;
export const seedScreenFiller = async (
  screenhostId: string,
  opts: { seconds?: number } = {},
): Promise<string> => {
  seq += 1;
  const seconds = opts.seconds ?? 3300;
  const [owner] = await db
    .insert(users)
    .values({
      email: `screen-filler-${seq}-${Math.random().toString(16).slice(2, 8)}@example.com`,
      contactName: `Screen filler ${seq}`,
      role: 'advertiser',
      status: 'approved',
    })
    .returning({ id: users.id });
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: owner?.id ?? '',
      name: `Screen filler ${seq}`,
      campaignType: 'standard',
      status: 'active',
      startDate: '2000-01-01',
      endDate: '2099-12-31',
    })
    .returning({ id: campaigns.id });
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: 10_000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '0.6',
      seuilDiffusable: 1000,
      sMin: '20',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 10_000,
      nMin: 1,
      nMax: 10,
      nRetenus: 1,
    })
    .returning({ id: campaignDispatchPlan.id });
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId,
    iiPotentiel: 1000,
    rI: Math.round(seconds / 10),
    revenuPrevisionnel: '10',
    creneaux: [],
    statutAcceptation: 'ACCEPTE',
  });
  return campaign?.id ?? '';
};
