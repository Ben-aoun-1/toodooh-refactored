import { describe, expect, it, vi } from 'vitest';

import { datesWire, persistDatesForAdvance } from './dates-advance';

// CF-HF2 — the operator's repro, pinned: fill the dates at Période, press Suivant WITHOUT
// Enregistrer → the dates MUST hit the server before the advance, or Validation mounts on a
// dateless draft and GET /:id/cmax 409s (CMAX_REQUIRES) — the budget step goes unusable.

describe('persistDatesForAdvance', () => {
  it("THE REPRO: dirty dates PATCH {start_date, end_date} — the exact fields cmax's 409 gate requires — before the advance", async () => {
    const update = vi.fn().mockResolvedValue({});
    const result = await persistDatesForAdvance({
      draftCampaignId: 'c1',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      persistedWire: null, // straight through — Enregistrer never pressed
      update,
    });
    expect(update).toHaveBeenCalledWith('c1', {
      start_date: '2026-08-01',
      end_date: '2026-08-03',
    });
    expect(result).toEqual({ ok: true, wire: datesWire('2026-08-01', '2026-08-03') });
  });

  it('a PATCH failure BLOCKS the advance (ok:false) and carries the error for the toast/log', async () => {
    const boom = new Error('500');
    const update = vi.fn().mockRejectedValue(boom);
    const result = await persistDatesForAdvance({
      draftCampaignId: 'c1',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      persistedWire: null,
      update,
    });
    expect(result).toEqual({ ok: false, error: boom });
  });

  it('CLEAN dates skip the wire (no redundant PATCH when Enregistrer or a prior advance already persisted them)', async () => {
    const update = vi.fn();
    const wire = datesWire('2026-08-01', '2026-08-03');
    const result = await persistDatesForAdvance({
      draftCampaignId: 'c1',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      persistedWire: wire,
      update,
    });
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, wire });
  });

  it('an edit AFTER a persist re-dirties (the wire identity covers both dates)', () => {
    expect(datesWire('2026-08-01', '2026-08-03')).not.toBe(datesWire('2026-08-01', '2026-08-04'));
    expect(datesWire(null, null)).toBe(datesWire(null, null));
  });

  it('no draft yet → pass through (the create-early draft owns this edge; nothing to PATCH)', async () => {
    const update = vi.fn();
    const result = await persistDatesForAdvance({
      draftCampaignId: null,
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      persistedWire: null,
      update,
    });
    expect(update).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});
