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

describe('the proposal render matrix (source pins — NOTIF-D2: the popup is the one surface)', () => {
  const body = read('../components/decision/EventDecisionDetails.tsx');
  const modal = read('../components/decision/DecisionModal.tsx');
  const app = read('../../../App.tsx');

  it('the event popup body shows match, période, venues, blocs and the spot (images incl.)', () => {
    expect(body).toContain('match_name');
    expect(body).toContain('EVENT_PERIODE_LINE');
    expect(body).toContain('blocs_count');
    expect(body).toContain('CreativePreviewTile'); // video AND image render (the wizard tile)
  });

  it('the popup decides events through the event path, campaigns through the campaign path', () => {
    expect(modal).toContain('useScreenhostEventAllocations');
    expect(modal).toContain('useScreenhostAllocations');
  });

  it('the old « Campagnes à valider » page is gone — its URL redirects to the dashboard', () => {
    expect(app).not.toContain('OwnerAllocations');
    expect(app).toMatch(
      /path="\/owner-allocations" element={<Navigate to="\/owner-dashboard" replace \/>}/,
    );
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
