import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_STATUS_FILTER_LABELS,
  AMOUNT_MIN_ERROR,
  BANK_COORDS_PENDING_LINE,
  JUSTIFICATIF_REQUIRED_ERROR,
  MIN_RECHARGE_TND,
  RECHARGE_TYPES,
  RECHARGE_TYPE_LABELS,
  adminStatusFilterLabels,
  bankCoordsProvided,
  isAdminDecidable,
  methodLabel,
  parseRechargeAmount,
  rechargeTypeOf,
  statusChipClass,
  statusLabel,
} from './recharge-methods';

// FCT1 — the v2 pure rules: the per-method status label MATRIX (US-FCT-8), the 500 TND floor, the
// « Pour info » provisioning rules, and the TWO-CARDS-ONLY source pin on the modal (no carte
// bancaire — card payment does not exist in the parcours).

describe('the per-method status label matrix (chips)', () => {
  it('virement: En attente de réception → Créditée | Annulée', () => {
    expect(statusLabel('virement', 'pending')).toBe('En attente de réception');
    expect(statusLabel('virement', 'confirmed')).toBe('Créditée');
    expect(statusLabel('virement', 'rejected')).toBe('Annulée');
  });

  it('bon: Bon émis → Bon retourné signé → Fonds reçus | Annulée', () => {
    expect(statusLabel('bon_de_commande', 'bon_issued')).toBe('Bon émis');
    expect(statusLabel('bon_de_commande', 'bon_returned')).toBe('Bon retourné signé');
    expect(statusLabel('bon_de_commande', 'confirmed')).toBe('Fonds reçus');
    expect(statusLabel('bon_de_commande', 'rejected')).toBe('Annulée');
  });

  it('legacy rows (method null) keep the as-found labels', () => {
    expect(statusLabel(null, 'pending')).toBe('En attente');
    expect(statusLabel(null, 'confirmed')).toBe('Validée');
    expect(statusLabel(null, 'rejected')).toBe('Annulée'); // GREEN2 — one refusal word, modal-aligned
  });

  it('every status has a chip class (total switch)', () => {
    for (const status of [
      'pending',
      'confirmed',
      'rejected',
      'bon_issued',
      'bon_returned',
    ] as const) {
      expect(statusChipClass(status)).toContain('bg-');
    }
  });

  it('the admin filter offers every display label — « Bon émis » visible (GREEN2 item 2), ONE refusal word (item 6)', () => {
    expect(ADMIN_STATUS_FILTER_LABELS).toEqual([
      'En attente',
      'En attente de réception',
      'Bon émis',
      'Bon retourné signé',
      'Validée',
      'Créditée',
      'Fonds reçus',
      'Annulée',
    ]);
  });
});

// RECH-ADM1 — the recharge TYPE is derived from the method (the reference prefix: VIR-/BC-/FCT-),
// and the admin status filter offers only the chosen type's labels (T1 A · T2 A). Read through
// statusLabel, never a second copy of the words — MyRecharges shares every label below.
describe('the recharge type (VIR / BC / FCT) and its status labels', () => {
  it('derives the type from the method — NULL is the legacy FCT format', () => {
    expect(rechargeTypeOf('virement')).toBe('VIR');
    expect(rechargeTypeOf('bon_de_commande')).toBe('BC');
    expect(rechargeTypeOf(null)).toBe('FCT');
  });

  it('labels the three types; FCT is the OLD FORMAT, not a third payment method (T1)', () => {
    expect(RECHARGE_TYPES).toEqual(['VIR', 'BC', 'FCT']);
    expect(RECHARGE_TYPE_LABELS).toEqual({
      VIR: 'Virement (VIR)',
      BC: 'Bon de commande (BC)',
      FCT: 'Ancien format (FCT)',
    });
  });

  it('VIR offers only its three labels (spec §3 US-FCT-8)', () => {
    expect(adminStatusFilterLabels('VIR')).toEqual([
      'En attente de réception',
      'Créditée',
      'Annulée',
    ]);
  });

  it('BC offers only its four labels', () => {
    expect(adminStatusFilterLabels('BC')).toEqual([
      'Bon émis',
      'Bon retourné signé',
      'Fonds reçus',
      'Annulée',
    ]);
  });

  it('FCT (legacy) offers only the as-found labels', () => {
    expect(adminStatusFilterLabels('FCT')).toEqual(['En attente', 'Validée', 'Annulée']);
  });

  it('« Tous les types » offers every label — the unchanged flat list', () => {
    expect(adminStatusFilterLabels('all')).toEqual(ADMIN_STATUS_FILTER_LABELS);
  });

  it('the three per-type lists cover the flat list exactly — no label lost, none invented', () => {
    const union = new Set(RECHARGE_TYPES.flatMap((t) => adminStatusFilterLabels(t)));
    expect([...union].sort()).toEqual([...ADMIN_STATUS_FILTER_LABELS].sort());
  });

  it('every offered label is a chip label of a row of that type (the filter can match it)', () => {
    const method = { VIR: 'virement', BC: 'bon_de_commande', FCT: null } as const;
    const statuses = ['pending', 'confirmed', 'rejected', 'bon_issued', 'bon_returned'] as const;
    for (const type of RECHARGE_TYPES) {
      const chips = new Set(statuses.map((s) => statusLabel(method[type], s)));
      for (const label of adminStatusFilterLabels(type)) expect(chips.has(label)).toBe(true);
    }
  });
});

describe('methodLabel (the screencaster Type column — MyRecharges)', () => {
  it('labels the two methods and renders legacy as « — » (the admin names it via adminRechargeTypeLabel)', () => {
    expect(methodLabel('virement')).toBe('Virement bancaire');
    expect(methodLabel('bon_de_commande')).toBe('Bon de commande');
    expect(methodLabel(null)).toBe('—');
  });
});

describe('parseRechargeAmount (the 500 TND floor + centime precision)', () => {
  it('accepts the floor, quick amounts and 2-decimal values', () => {
    expect(parseRechargeAmount('500')).toBe(500);
    expect(parseRechargeAmount('10000')).toBe(10000);
    expect(parseRechargeAmount('750.50')).toBe(750.5);
  });

  it('rejects under-floor, empty, non-numeric and >2-decimal input', () => {
    expect(parseRechargeAmount('499.99')).toBeNull();
    expect(parseRechargeAmount('10')).toBeNull();
    expect(parseRechargeAmount('')).toBeNull();
    expect(parseRechargeAmount('abc')).toBeNull();
    expect(parseRechargeAmount('500.505')).toBeNull();
  });

  it('pins the French copy + the floor value', () => {
    expect(MIN_RECHARGE_TND).toBe(500);
    expect(AMOUNT_MIN_ERROR).toBe('Le montant minimum est de 500 TND HT (595 TND TTC)');
    expect(JUSTIFICATIF_REQUIRED_ERROR).toBe('Le justificatif de virement est obligatoire.');
  });
});

describe('isAdminDecidable (Valider/Annuler visibility)', () => {
  it('virement + legacy decide while pending; a bon only once bon_returned', () => {
    expect(isAdminDecidable({ method: 'virement', status: 'pending' })).toBe(true);
    expect(isAdminDecidable({ method: null, status: 'pending' })).toBe(true);
    expect(isAdminDecidable({ method: 'bon_de_commande', status: 'bon_returned' })).toBe(true);
    expect(isAdminDecidable({ method: 'bon_de_commande', status: 'bon_issued' })).toBe(false);
    expect(isAdminDecidable({ method: 'virement', status: 'confirmed' })).toBe(false);
    expect(isAdminDecidable({ method: null, status: 'rejected' })).toBe(false);
  });
});

describe('the « Pour info » coordinates rules', () => {
  it('an all-placeholder quartet is NOT provisioned → the pending line shows', () => {
    expect(bankCoordsProvided({ rib: '—', iban: '—', bic: '—', domiciliation: '—' })).toBe(false);
    expect(BANK_COORDS_PENDING_LINE).toBe('Coordonnées bancaires communiquées prochainement.');
  });

  it('any real value makes the block render', () => {
    expect(bankCoordsProvided({ rib: 'TN59 123', iban: '—', bic: '—', domiciliation: '—' })).toBe(
      true,
    );
  });
});

describe('the modal offers EXACTLY two methods (pinned against the component source)', () => {
  const modalSource = readFileSync(
    fileURLToPath(new URL('../components/NewRechargeModal.tsx', import.meta.url)),
    'utf8',
  );

  it('is two-step: montant → méthode', () => {
    expect(modalSource).toContain('Étape 1 — Montant');
    expect(modalSource).toContain('Étape 2 — Méthode de paiement');
  });

  it('offers virement + bon de commande and NO carte bancaire', () => {
    // Exactly TWO methodCard call sites (the definition reads `methodCard = (`, not `methodCard(`).
    expect(modalSource.split('methodCard(').length - 1).toBe(2);
    expect(modalSource).toContain("'virement'");
    expect(modalSource).toContain("'bon_de_commande'");
    expect(modalSource.toLowerCase()).not.toContain('carte');
  });

  it('marks the justificatif REQUIRED and wires the mandatory-file error', () => {
    expect(modalSource).toContain('Justificatif de virement (PDF ou image) *');
    expect(modalSource).toContain('JUSTIFICATIF_REQUIRED_ERROR');
  });
});
