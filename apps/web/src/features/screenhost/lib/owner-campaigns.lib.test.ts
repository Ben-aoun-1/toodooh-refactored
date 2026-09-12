import { describe, expect, it } from 'vitest';

import type { OwnerCampaign } from '@/features/screenhost/services/screenhost-campaigns.service';

import {
  DECIDE_ROUTE,
  EMPTY_STATE_DETAIL,
  EMPTY_STATE_TITLE,
  LOAD_ERROR_MESSAGE,
  STATUS_FILTERS,
  allocationStatutLabel,
  countByFilter,
  decisionUi,
  fmtDate,
  fmtDateRange,
  matchesSearch,
  matchesStatusFilter,
  needsDecision,
  statusUi,
  venuesLabel,
} from './owner-campaigns.lib';

// CAMP-E1 — the owner « Mes campagnes » page has no render harness; its status/decision mapping,
// tab predicates and copy are pinned here.

const campaign = (overrides: Partial<OwnerCampaign> = {}): OwnerCampaign => ({
  id: 'c1',
  name: 'Campagne Été',
  campaign_type: 'standard',
  status: 'active',
  start_date: '2026-07-20',
  end_date: '2026-07-27',
  advertiser_name: 'Acme Pub',
  categories: [],
  zones: [],
  creative: null,
  allocations: [],
  totals: { ii_potentiel: 0, revenu_previsionnel: 0 },
  owner_decision: 'EN_ATTENTE',
  created_at: '2026-07-15T00:00:00.000Z',
  ...overrides,
});

describe('needsDecision (« À valider »)', () => {
  it('is EN_ATTENTE or MIXTE — a partial decision still needs the owner', () => {
    expect(needsDecision('EN_ATTENTE')).toBe(true);
    expect(needsDecision('MIXTE')).toBe(true);
    expect(needsDecision('ACCEPTE')).toBe(false);
    expect(needsDecision('REFUSE')).toBe(false);
  });
});

describe('matchesStatusFilter (the tabs)', () => {
  it('« À valider » is on the owner-decision axis regardless of campaigns.status', () => {
    expect(matchesStatusFilter(campaign({ status: 'completed' }), 'to_decide')).toBe(true);
    expect(matchesStatusFilter(campaign({ owner_decision: 'ACCEPTE' }), 'to_decide')).toBe(false);
  });

  it('the other tabs map onto campaigns.status', () => {
    for (const status of ['active', 'upcoming', 'pending', 'completed'] as const) {
      expect(matchesStatusFilter(campaign({ status }), status)).toBe(true);
      expect(matchesStatusFilter(campaign({ status: 'draft' }), status)).toBe(false);
    }
    expect(matchesStatusFilter(campaign({ status: 'draft' }), 'all')).toBe(true);
  });

  it('the tab list is exactly Tous / À valider / Actives / À venir / En attente / Terminées', () => {
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual([
      'Tous',
      'À valider',
      'Actives',
      'À venir',
      'En attente',
      'Terminées',
    ]);
  });
});

describe('countByFilter', () => {
  it('counts every tab over the list', () => {
    const counts = countByFilter([
      campaign({ status: 'active', owner_decision: 'ACCEPTE' }),
      campaign({ status: 'active', owner_decision: 'MIXTE' }),
      campaign({ status: 'upcoming' }),
      campaign({ status: 'completed', owner_decision: 'REFUSE' }),
    ]);
    expect(counts).toEqual({
      all: 4,
      to_decide: 2,
      active: 2,
      upcoming: 1,
      pending: 0,
      completed: 1,
    });
  });
});

describe('matchesSearch', () => {
  it('matches the campaign name OR the advertiser, case-insensitively; blank matches all', () => {
    expect(matchesSearch(campaign(), '  ')).toBe(true);
    expect(matchesSearch(campaign(), 'été')).toBe(true);
    expect(matchesSearch(campaign(), 'ACME')).toBe(true);
    expect(matchesSearch(campaign(), 'hiver')).toBe(false);
  });
});

describe('statusUi / decisionUi / allocationStatutLabel', () => {
  it('maps campaigns.status to the French badge, unknown → En attente', () => {
    expect(statusUi('active').label).toBe('Active');
    expect(statusUi('upcoming').label).toBe('À venir');
    expect(statusUi('pending').label).toBe('En attente');
    expect(statusUi('completed').label).toBe('Terminée');
    expect(statusUi('rejected').label).toBe('Refusée');
    expect(statusUi('draft').label).toBe('Brouillon');
    expect(statusUi('whatever').label).toBe('En attente');
  });

  it('the owner decision chip tells THEIR side', () => {
    expect(decisionUi('EN_ATTENTE').label).toBe('À valider');
    expect(decisionUi('MIXTE').label).toBe('Décision partielle');
    expect(decisionUi('ACCEPTE').label).toBe('Acceptée');
    expect(decisionUi('REFUSE').label).toBe('Refusée par vous');
  });

  it('per-venue statut labels', () => {
    expect(allocationStatutLabel('EN_ATTENTE')).toBe('En attente');
    expect(allocationStatutLabel('ACCEPTE')).toBe('Acceptée');
    expect(allocationStatutLabel('REFUSE')).toBe('Refusée');
  });
});

describe('formatting', () => {
  it('fmtDate / fmtDateRange tolerate null and garbage', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('not-a-date')).toBe('—');
    expect(fmtDate('2026-07-20')).toBe(new Date('2026-07-20').toLocaleDateString('fr-FR'));
    expect(fmtDateRange('2026-07-20', null)).toBe('—');
    expect(fmtDateRange('2026-07-20', '2026-07-27')).toContain(' -> ');
  });

  it('venuesLabel pluralises', () => {
    expect(venuesLabel(1)).toBe('1 établissement');
    expect(venuesLabel(3)).toBe('3 établissements');
  });
});

describe('copy pins', () => {
  it('the empty state is calm French (Mejri 2026-09-11) and the error stays a toast message', () => {
    expect(EMPTY_STATE_TITLE).toBe('Aucune campagne pour le moment');
    expect(EMPTY_STATE_DETAIL).toContain('vos établissements');
    expect(LOAD_ERROR_MESSAGE).toBe('Impossible de charger les campagnes');
  });

  it('the decision CTA routes to the accept/reject surface (never duplicated here)', () => {
    expect(DECIDE_ROUTE).toBe('/owner-allocations');
  });
});
