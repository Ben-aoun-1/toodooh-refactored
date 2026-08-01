import { describe, expect, it } from 'vitest';

import {
  FACTURE_ACTION_LABEL,
  FACTURE_STATUTS,
  FACTURE_STATUT_LABEL,
  MOTIF_REQUIRED_ERROR,
  PAPER_CONFIRM_MESSAGE,
  type FactureAction,
  type FactureStatut,
  actionsForFacture,
  factureStatutChip,
  factureStatutLabel,
  isValidMotif,
} from './screenhost-facture-status';

// REV3 — the admin contextual-action matrix. It decides which MONEY-MOVING buttons an admin is
// offered, so it lives in a pure module and is pinned here: apps/web has no render harness, and a
// matrix inline in JSX would be untestable by construction.
//
// It must mirror the api's guard. Where they disagree the api wins (it 409s), so a divergence
// shows a button that cannot work — bad, but never an illegal transition.

const row = (status: FactureStatut, deposited: boolean) => ({
  status,
  deposited_at: deposited ? '2026-08-03T09:00:00.000Z' : null,
});

/** The api's matrix, restated independently — the test must not read the same table it checks. */
const EXPECTED: Record<FactureStatut, { deposited: FactureAction[]; fresh: FactureAction[] }> = {
  emise: { deposited: ['voir'], fresh: ['paper'] },
  en_verification: { deposited: ['voir', 'valider', 'refuser'], fresh: ['valider', 'refuser'] },
  en_paiement: { deposited: ['voir', 'marquer-payee'], fresh: ['marquer-payee'] },
  refusee: { deposited: ['voir'], fresh: [] },
  payee: { deposited: ['voir'], fresh: [] },
};

describe('actionsForFacture (the contextual matrix, per status)', () => {
  for (const statut of FACTURE_STATUTS) {
    it(`${statut}, deposited → ${EXPECTED[statut].deposited.join(' + ') || 'nothing'}`, () => {
      expect(actionsForFacture(row(statut, true))).toEqual(EXPECTED[statut].deposited);
    });
    it(`${statut}, never deposited → ${EXPECTED[statut].fresh.join(' + ') || 'nothing'}`, () => {
      expect(actionsForFacture(row(statut, false))).toEqual(EXPECTED[statut].fresh);
    });
  }

  it('« Marquer payée (papier) » is offered ONLY on an emise facture that was never deposited', () => {
    // The guard that matters: a deposited document is waiting to be checked, and the paper path
    // would pay it without that check. The api refuses it too — this keeps the button away.
    expect(actionsForFacture(row('emise', false))).toContain('paper');
    expect(actionsForFacture(row('emise', true))).not.toContain('paper');
    for (const statut of FACTURE_STATUTS.filter((s) => s !== 'emise')) {
      expect(actionsForFacture(row(statut, false))).not.toContain('paper');
      expect(actionsForFacture(row(statut, true))).not.toContain('paper');
    }
  });

  it('Valider and Refuser exist on en_verification and NOWHERE else', () => {
    for (const statut of FACTURE_STATUTS) {
      const both = [
        ...actionsForFacture(row(statut, true)),
        ...actionsForFacture(row(statut, false)),
      ];
      const offered = both.includes('valider') || both.includes('refuser');
      expect(offered).toBe(statut === 'en_verification');
    }
  });

  it('« Voir » appears whenever a signed document exists — including on a paid facture', () => {
    // A settled facture's document is still the thing that was paid; the admin must be able to
    // re-open it.
    expect(actionsForFacture(row('payee', true))).toContain('voir');
    expect(actionsForFacture(row('payee', false))).not.toContain('voir');
  });
});

describe('the status vocabulary (the pill — admin-side only)', () => {
  it('labels every status in French, with the spec’s wording', () => {
    expect(FACTURE_STATUT_LABEL.en_paiement).toBe('En cours de paiement');
    expect(FACTURE_STATUT_LABEL.refusee).toBe('Facture refusée');
    expect(FACTURE_STATUT_LABEL.payee).toBe('Payée');
    for (const statut of FACTURE_STATUTS) {
      expect(factureStatutLabel(statut)).toBe(FACTURE_STATUT_LABEL[statut]);
      expect(factureStatutChip(statut)).toContain('bg-');
    }
  });

  it('an unknown status degrades instead of rendering blank', () => {
    expect(factureStatutLabel('mystery')).toBe('mystery');
    expect(factureStatutChip('mystery')).toContain('bg-gray-100');
  });

  it('every offered action has French button copy', () => {
    const actions: FactureAction[] = ['voir', 'valider', 'refuser', 'marquer-payee', 'paper'];
    for (const a of actions) expect(FACTURE_ACTION_LABEL[a].length).toBeGreaterThan(0);
    expect(FACTURE_ACTION_LABEL.paper).toContain('papier');
  });
});

describe('the two guards the UI owes the admin', () => {
  it('the paper confirm names the CONSEQUENCE, not just "are you sure"', () => {
    expect(PAPER_CONFIRM_MESSAGE).toContain('versement');
    expect(PAPER_CONFIRM_MESSAGE).toContain('irréversible');
  });

  it('an empty or whitespace motif is refused client-side, matching the api’s 400', () => {
    expect(isValidMotif('Cachet manquant.')).toBe(true);
    expect(isValidMotif('')).toBe(false);
    expect(isValidMotif('   ')).toBe(false);
    expect(isValidMotif('\n\t')).toBe(false);
    expect(MOTIF_REQUIRED_ERROR).toContain('motif');
  });
});
