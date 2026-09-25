import { describe, expect, it } from 'vitest';

import { type InspectionRun, runLine, settlementLine } from './sim-inspector';

// SIM-6 phase 2 — the inspector's French renderings of the engine's own verdicts.
const run = (
  phase: string,
  summary: Record<string, unknown>,
  outcome = 'committed',
): InspectionRun => ({
  run_id: 'r',
  phase,
  outcome,
  started_at: '2026-09-24T12:00:00Z',
  summary,
  events: [],
});

describe('runLine — one engine run in words', () => {
  it('a redispatch below the threshold names the running loss', () => {
    expect(runLine(run('redispatch', { result: 'BELOW_THRESHOLD', totalValueTnd: 16.94 }))).toBe(
      `Rattrapage — sous le seuil de 20 TND (perte ${(16.94).toLocaleString('fr-FR')} TND)`,
    );
  });

  it('nothing placeable is said plainly; an unknown code falls through verbatim', () => {
    expect(runLine(run('redispatch', { result: 'NOTHING_PLACEABLE', vFact: 3959 }))).toBe(
      'Rattrapage — aucun établissement ne peut reprendre le volume',
    );
    expect(runLine(run('dispatch', { status: 'SOMETHING_NEW' }))).toBe('Dispatch — SOMETHING_NEW');
  });

  it('without a verdict it falls back to the run outcome', () => {
    expect(runLine(run('cascade', {}, 'rolled_back'))).toBe('Cascade (refus) — rolled_back');
  });
});

describe('settlementLine', () => {
  const base = {
    status: 'partial',
    expected_imp: 0,
    delivered_imp: 0,
    settled_at: '',
    payouts: [],
    reversement: [],
    event_delivery: null,
  };

  it('says what was debited and what was refunded', () => {
    expect(settlementLine({ ...base, spend_tnd: 200, refund_tnd: 100 })).toBe(
      `Débité ${(200).toLocaleString('fr-FR')} TND · remboursé ${(100).toLocaleString('fr-FR')} TND`,
    );
  });

  it('a full delivery says so', () => {
    expect(settlementLine({ ...base, status: 'reussie', spend_tnd: 300, refund_tnd: 0 })).toBe(
      `Débité ${(300).toLocaleString('fr-FR')} TND · diffusion intégralement assurée`,
    );
  });
});
