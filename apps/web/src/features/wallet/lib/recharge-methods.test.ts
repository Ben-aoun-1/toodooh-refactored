import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_STATUS_FILTER_LABELS,
  AMOUNT_MIN_ERROR,
  BANK_COORDS_PENDING_LINE,
  JUSTIFICATIF_REQUIRED_ERROR,
  MIN_RECHARGE_TND,
  bankCoordsProvided,
  isAdminDecidable,
  methodLabel,
  parseRechargeAmount,
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

describe('methodLabel (the admin Type column)', () => {
  it('labels the two methods and renders legacy as « — »', () => {
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
