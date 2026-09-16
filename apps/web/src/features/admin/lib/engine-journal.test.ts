import { describe, expect, it } from 'vitest';

import {
  EMITTED_EVENT_TYPES,
  ENGINE_JOURNAL_EMPTY_STATE,
  EVENT_LABELS,
  EXCLUSION_REASON_LABELS,
  PHASE_LABELS,
  eventDetail,
  eventLabel,
  formatTunis,
  outcomeChip,
} from './engine-journal';

// LOG1 — the timeline's pure display model. The label map is PINNED against the api's emitted
// event set: a new emitter without a French label fails here, not in front of the operator.

describe('label coverage — every emitted event_type has a French label', () => {
  it.each(EMITTED_EVENT_TYPES)('labels %s', (type) => {
    expect(EVENT_LABELS[type]).toBeTruthy();
  });

  it('pins the emitted set (grow it when the api grows)', () => {
    expect([...EMITTED_EVENT_TYPES].sort()).toEqual(
      [
        'venue_excluded',
        'pool_assembled',
        'allocation_placed',
        'reliquat_stored',
        'partial_coverage',
        'refusal_received',
        'replacement_placed',
        'manquement_detected',
        'redispatch_valued',
        'rattrapage_placed',
        'reliquat_consumed',
        'split_recorded',
        'refund_issued',
        'residue_kept',
        'perimeter_added',
      ].sort(),
    );
  });

  it('labels every exclusion reason the pool can emit', () => {
    for (const reason of [
      'inactive',
      'capacity_missing',
      'hours_missing',
      'targeting_mismatch',
      'zone_mismatch',
      'excluded',
      'no_available_days',
      'no_residual_capacity',
      'owner_not_approved',
    ]) {
      expect(EXCLUSION_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});

describe('eventLabel', () => {
  it('composes the exclusion label with its reason (charter example)', () => {
    expect(
      eventLabel({
        event_type: 'venue_excluded',
        screenhost_id: 'x',
        screenhost_name: 'Café',
        payload: { reason: 'hours_missing' },
      }),
    ).toBe('Établissement exclu — horaires manquants');
  });

  it('ELIG-2 — names a venue left out because its owner is not validated', () => {
    expect(
      eventLabel({
        event_type: 'venue_excluded',
        screenhost_id: 'x',
        screenhost_name: 'Café',
        payload: { reason: 'owner_not_approved' },
      }),
    ).toBe('Établissement exclu — propriétaire non validé');
  });

  it('labels the plain events', () => {
    expect(
      eventLabel({
        event_type: 'allocation_placed',
        screenhost_id: 'x',
        screenhost_name: 'Café',
        payload: {},
      }),
    ).toBe('Allocation placée');
    expect(
      eventLabel({
        event_type: 'split_recorded',
        screenhost_id: 'x',
        screenhost_name: null,
        payload: {},
      }),
    ).toBe('Reversement enregistré');
  });

  it('falls back to the raw type for an unknown event (forward-compatible)', () => {
    expect(
      eventLabel({
        event_type: 'brand_new',
        screenhost_id: null,
        screenhost_name: null,
        payload: {},
      }),
    ).toBe('brand_new');
  });
});

describe('eventDetail', () => {
  it('renders impressions + montant HT (TTC) when present', () => {
    const detail = eventDetail({
      event_type: 'allocation_placed',
      screenhost_id: 'x',
      screenhost_name: 'Café',
      payload: { impressions: 5000, valueTnd: 50 },
    });
    expect(detail).toContain(`${(5000).toLocaleString('fr-FR')} imp.`);
    expect(detail).toContain('50 TND HT');
  });

  it('renders the settlement split amounts', () => {
    const detail = eventDetail({
      event_type: 'split_recorded',
      screenhost_id: 'x',
      screenhost_name: 'Café',
      payload: { baseTnd: 200, shTnd: 100 },
    });
    expect(detail).toContain('base');
    expect(detail).toContain('200 TND HT');
  });

  it('is empty for a payload with no displayable keys', () => {
    expect(
      eventDetail({
        event_type: 'pool_assembled',
        screenhost_id: null,
        screenhost_name: null,
        payload: { seq: 3 },
      }),
    ).toBe('');
  });
});

describe('outcomeChip', () => {
  it('labels a committed run « Exécuté »', () => {
    expect(outcomeChip({ outcome: 'committed', summary: {} })).toBe('Exécuté');
  });

  it('labels a rolled-back run with its French reason', () => {
    expect(outcomeChip({ outcome: 'rolled_back', summary: { reason: 'TOO_THIN' } })).toBe(
      'Annulé — plan trop mince (N_min > N_max)',
    );
    expect(outcomeChip({ outcome: 'rolled_back', summary: { reason: 'NO_ELIGIBLE' } })).toBe(
      'Annulé — aucun établissement éligible',
    );
    expect(outcomeChip({ outcome: 'rolled_back', summary: { reason: 'UNKNOWN_X' } })).toBe(
      'Annulé — UNKNOWN_X',
    );
  });
});

describe('phase labels + chrome', () => {
  it('pins the five phase badges', () => {
    expect(PHASE_LABELS).toEqual({
      dispatch: 'Dispatch',
      cascade: 'Cascade',
      redispatch: 'Redispatching',
      settlement: 'Règlement',
      boost: 'Boost',
    });
  });

  it('pins the empty state', () => {
    expect(ENGINE_JOURNAL_EMPTY_STATE).toBe('Aucune exécution du moteur pour cette campagne.');
  });

  it('renders the horodatage in Africa/Tunis regardless of the browser zone', () => {
    // 2026-07-01T10:00:00Z = 11:00 in Africa/Tunis (UTC+1).
    expect(formatTunis('2026-07-01T10:00:00.000Z')).toMatch(/11:00/);
  });
});
