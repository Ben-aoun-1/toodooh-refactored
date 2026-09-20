import { describe, expect, it } from 'vitest';

import { campaignTypeLabel, eventAllocationStatutLabel } from './campaign-labels';

// ADM-FIX1 — the admin surfaces printed these wire values raw in an otherwise French UI.

describe('campaignTypeLabel', () => {
  it('labels the two known types in French', () => {
    expect(campaignTypeLabel({ campaign_type: 'standard', event_id: null })).toBe('Standard');
    expect(campaignTypeLabel({ campaign_type: 'event', event_id: null })).toBe('Événement');
  });

  it('derives « Événement » from the event_id BINDING, whatever campaign_type says', () => {
    expect(campaignTypeLabel({ campaign_type: 'standard', event_id: 'evt-1' })).toBe('Événement');
    expect(campaignTypeLabel({ campaign_type: 'event', event_id: 'evt-1' })).toBe('Événement');
  });

  it('shows an unknown type as-is rather than mislabelling it « Standard »', () => {
    expect(campaignTypeLabel({ campaign_type: 'boost', event_id: null })).toBe('boost');
  });
});

describe('eventAllocationStatutLabel', () => {
  it('labels the three CHECK values of event_allocations.statut', () => {
    expect(eventAllocationStatutLabel('EN_ATTENTE')).toBe('En attente');
    expect(eventAllocationStatutLabel('ACCEPTE')).toBe('Acceptée');
    expect(eventAllocationStatutLabel('REFUSE')).toBe('Refusée');
  });

  it('shows an unknown statut as-is', () => {
    expect(eventAllocationStatutLabel('EXPIRE')).toBe('EXPIRE');
  });
});
