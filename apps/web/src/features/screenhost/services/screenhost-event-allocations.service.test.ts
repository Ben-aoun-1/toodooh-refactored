import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EVENT_PERIODE_LINE,
  EVENT_REFUSE_CONFIRM,
  EVENT_REFUSED_STATE_DETAIL,
  EVENT_REFUSED_STATE_LABEL,
} from './screenhost-event-allocations.service';

// EV4 — the owner event-proposal surface: the pinned copies + the render-matrix source pins
// (no render harness — the ev1-pins idiom).

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the §11.1 proposal copies (ONE home)', () => {
  it('the période line spells the ± 1 h contract; refusal confirms and is final', () => {
    expect(EVENT_PERIODE_LINE).toBe('1 h avant · match · 1 h après');
    expect(EVENT_REFUSE_CONFIRM).toContain('Refuser cet événement ?');
    expect(EVENT_REFUSE_CONFIRM).toContain('Cette action est définitive.');
    expect(EVENT_REFUSED_STATE_LABEL).toBe('Refus enregistré');
    expect(EVENT_REFUSED_STATE_DETAIL).toBe('Cet événement ne sera pas diffusé sur cet écran.');
  });
});

describe('the proposal render matrix (source pins — event vs campaign)', () => {
  const card = read('../components/EventAllocationCard.tsx');
  const page = read('../pages/OwnerAllocations.tsx');

  it('the event card shows match, période, montant HT (TTC), blocs and the spot (images incl.)', () => {
    expect(card).toContain('match_name');
    expect(card).toContain('EVENT_PERIODE_LINE');
    expect(card).toContain('htTtcLabel'); // montant HT (TTC) via lib/money
    expect(card).toContain('blocs_count');
    expect(card).toContain('CreativePreviewTile'); // video AND image render (the wizard tile)
  });

  it('the owner page mounts the ÉVÉNEMENTS section as a SIBLING — campaign rendering untouched', () => {
    expect(page).toContain('useScreenhostEventAllocations');
    expect(page).toContain('EventAllocationCard');
    // The campaign card markup keeps its own service + components (pinned by their own suite);
    // the event section never reuses the campaign decision path.
    expect(page).toContain('useScreenhostAllocations');
    expect(page).toContain('AllocationSpotViewer');
  });

  it('accept speaks the API reminder; refuse confirms with the event copy', () => {
    expect(page).toContain('EVENT_REFUSE_CONFIRM');
    expect(page).toMatch(/reminder \?\? 'Événement accepté\.'/);
  });
});

describe('the advertiser + admin visibility (source pins)', () => {
  it('the Consulter drawer mounts the placement block on the BINDING only', () => {
    const myCampaigns = read('../../campaigns/pages/MyCampaigns.tsx');
    expect(myCampaigns).toContain('EventPlacementSummary');
    expect(myCampaigns).toMatch(/selectedCampaign\?\.event_id \? \(/);
  });

  it('the admin examen renders the allocations table on the BINDING only', () => {
    const queue = read('../../admin/pages/CampaignReviewQueue.tsx');
    expect(queue).toContain('event-allocations');
    expect(queue).toContain('Allocations événement:');
    expect(queue).toMatch(/selected\.event_id &&/);
  });
});
