import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DECISION_TYPE_LABEL,
  campaignDecisionRevenueTnd,
  eventDecisionRevenueTnd,
} from './decision-notifications';

// Operator 2026-10-12 — the screenhost's accept/refuse popup: it leads with what the owner earns,
// the type chip reads « Particuliers », and the categories block is gone.

const alloc = (statut: string, revenu: number) => ({
  statut_acceptation: statut,
  revenu_previsionnel: revenu,
});

describe('what the owner earns by accepting', () => {
  it('a campaign: Σ the share of the venues still awaiting a decision, to the millime', () => {
    expect(
      campaignDecisionRevenueTnd({
        allocations: [alloc('EN_ATTENTE', 12.345), alloc('EN_ATTENTE', 7.1), alloc('ACCEPTE', 99)],
        totals: { revenu_previsionnel: 118.445 },
      }),
    ).toBe(19.445);
  });

  it('a campaign with nothing pending: its total', () => {
    expect(
      campaignDecisionRevenueTnd({
        allocations: [alloc('ACCEPTE', 10), alloc('REFUSE', 5)],
        totals: { revenu_previsionnel: 10 },
      }),
    ).toBe(10);
  });

  it('an event: Σ the pending proposals’ montant (already the owner’s share)', () => {
    expect(eventDecisionRevenueTnd([{ montant_tnd: 4.2 }, { montant_tnd: 0.105 }])).toBe(4.305);
  });
});

describe('the popup source', () => {
  const read = (f: string): string =>
    readFileSync(join(__dirname, '..', 'components', 'decision', f), 'utf8');

  it('leads with the revenue, reads « Particuliers », and has no categories block', () => {
    const campaign = read('CampaignDecisionDetails.tsx');
    expect(DECISION_TYPE_LABEL).toBe('Particuliers');
    expect(campaign).toContain(
      '<DecisionRevenue amountTnd={campaignDecisionRevenueTnd(campaign)} />',
    );
    expect(campaign).toContain('{DECISION_TYPE_LABEL}');
    expect(campaign).not.toContain('Réseau Toodooh');
    expect(campaign).not.toContain('Catégorie(s)');
    expect(read('EventDecisionDetails.tsx')).toContain(
      '<DecisionRevenue amountTnd={eventDecisionRevenueTnd(proposals)} />',
    );
  });
});
