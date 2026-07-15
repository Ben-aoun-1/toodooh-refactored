import { describe, expect, it, vi } from 'vitest';

// The service module builds on apiClient — stubbed: only the pure CF-Q1/CF-O1 helpers are under test.
vi.mock('@/lib/api-client', () => ({ apiClient: {} }));

import {
  ACCEPT_ALLOCATION_REMINDER,
  type PendingAllocation,
  REFUSED_STATE_DETAIL,
  REFUSED_STATE_LABEL,
  REJECT_ALLOCATION_CONFIRM,
  campaignTypeLabel,
  categoriesLabel,
  decisionNeedsConfirm,
  displayAllocations,
  revenueLabel,
  spotViewerProps,
  zonesLabel,
} from './screenhost-allocations.service';

// CF-Q1 — the owner's money leads each allocation card, and ONLY reject asks for confirmation.

describe('revenueLabel (spec 2.2 « en tête le montant qui me revient »)', () => {
  it('formats fr-FR with the TND unit', () => {
    expect(revenueLabel(412)).toBe('412 TND');
    expect(revenueLabel(1065.5)).toBe('1 065,5 TND'); // fr-FR NNBSP grouping
    expect(revenueLabel(0)).toBe('0 TND');
  });
});

describe('decisionNeedsConfirm (reject is consequential; accept stays one-click)', () => {
  it('asks only for reject', () => {
    expect(decisionNeedsConfirm('reject')).toBe(true);
    expect(decisionNeedsConfirm('accept')).toBe(false);
  });

  it('the confirmation copy is the ruled French message (no reattribution claim — no cascade yet)', () => {
    expect(REJECT_ALLOCATION_CONFIRM).toBe('Refuser cette campagne ? Cette action est définitive.');
  });
});

// ── CF-O1 — the full proposal on the card + decision states (spec §2.2) ────────────────────────

const allocation = (overrides: Partial<PendingAllocation> = {}): PendingAllocation => ({
  id: 'a1',
  campaign_id: 'c1',
  campaign_name: 'Campagne Été',
  campaign_type: 'standard',
  start_date: '2026-07-20',
  end_date: '2026-07-27',
  screenhost_id: 's1',
  screenhost_name: 'Café Nord',
  ii_potentiel: 500,
  r_i: 100,
  revenu_previsionnel: 7.5,
  created_at: '2026-07-15T00:00:00.000Z',
  categories: [],
  zones: [],
  creative: null,
  ...overrides,
});

describe('proposal labels (type, catégories, zones)', () => {
  it('maps the wire campaign_type to the owner-facing French label', () => {
    expect(campaignTypeLabel('standard')).toBe('Campagne');
    expect(campaignTypeLabel('event')).toBe('Événement');
    // An unknown future token passes through rather than mislabeling.
    expect(campaignTypeLabel('parc-tv')).toBe('parc-tv');
  });

  it('categories: names joined, [] = « Toutes les catégories »', () => {
    expect(categoriesLabel(['Café', 'Restaurant'])).toBe('Café, Restaurant');
    expect(categoriesLabel([])).toBe('Toutes les catégories');
  });

  it('zones: names joined, [] = « Tout le réseau » (same fallback as the wizard recap, CF-Z1)', () => {
    expect(zonesLabel(['Grand Tunis'])).toBe('Grand Tunis');
    expect(zonesLabel([])).toBe('Tout le réseau');
  });
});

describe('spotViewerProps (the spot viewer renders per creative kind)', () => {
  it('a video creative → video tile props (inline player)', () => {
    expect(
      spotViewerProps(allocation({ creative: { kind: 'video', duration_seconds: 20 } })),
    ).toEqual({ creativeType: 'video', durationSeconds: 20, title: 'Campagne Été' });
  });

  it('a photo creative → photo tile props (image fill)', () => {
    expect(
      spotViewerProps(allocation({ creative: { kind: 'photo', duration_seconds: 10 } })),
    ).toEqual({ creativeType: 'photo', durationSeconds: 10, title: 'Campagne Été' });
  });

  it('no creative → null (no viewer, no presign fetch)', () => {
    expect(spotViewerProps(allocation())).toBeNull();
  });
});

describe('decision-state copy (pinned)', () => {
  it('accept success shows the keep-screens-active reminder (replaces the bare toast)', () => {
    expect(ACCEPT_ALLOCATION_REMINDER).toBe(
      'Campagne acceptée — pensez à maintenir vos écrans actifs pour assurer la diffusion.',
    );
  });

  it('a confirmed refusal flips the card to « Refus enregistré »', () => {
    expect(REFUSED_STATE_LABEL).toBe('Refus enregistré');
    expect(REFUSED_STATE_DETAIL).toBe('Cette campagne ne sera pas diffusée sur cet écran.');
  });
});

describe('displayAllocations (refused cards stay visible in their state)', () => {
  it('annotates pending rows with their session refusal state', () => {
    const kept = allocation({ id: 'a1' });
    const refused = allocation({ id: 'a2' });
    const shown = displayAllocations([kept, refused], new Map([['a2', refused]]));
    expect(shown).toEqual([
      { allocation: kept, refused: false },
      { allocation: refused, refused: true },
    ]);
  });

  it('a refused card the server no longer returns is appended — it never vanishes mid-session', () => {
    const kept = allocation({ id: 'a1' });
    const refused = allocation({ id: 'a2' });
    const shown = displayAllocations([kept], new Map([['a2', refused]]));
    expect(shown).toEqual([
      { allocation: kept, refused: false },
      { allocation: refused, refused: true },
    ]);
  });

  it('no refusals → the pending list untouched', () => {
    const a = allocation();
    expect(displayAllocations([a], new Map())).toEqual([{ allocation: a, refused: false }]);
  });
});
