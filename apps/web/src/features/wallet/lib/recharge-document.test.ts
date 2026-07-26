import { describe, expect, it } from 'vitest';

import {
  MAX_JUSTIFICATIF_BYTES,
  isJustificatifTooLarge,
  justificatifAffordances,
} from './recharge-document';

// FCT1 retired the createRechargeWithDocument two-call seam — a virement demande is now created
// WITH its mandatory justificatif in ONE multipart call (pinned in wallet.service.test.ts). What
// stays pinned here: the MyInvoices affordance matrix + the 10 Mo client pre-check.

describe('justificatifAffordances (per-state attach/replace/view matrix)', () => {
  it('pending without document → Ajouter, no view', () => {
    expect(justificatifAffordances({ statut: 'pending', has_document: false })).toEqual({
      canAttach: true,
      attachLabel: 'Ajouter le justificatif',
      canView: false,
    });
  });

  it('pending with document → Remplacer + view', () => {
    expect(justificatifAffordances({ statut: 'pending', has_document: true })).toEqual({
      canAttach: true,
      attachLabel: 'Remplacer le justificatif',
      canView: true,
    });
  });

  it.each(['confirmed', 'rejected'] as const)('%s with document → view only', (statut) => {
    expect(justificatifAffordances({ statut, has_document: true })).toEqual({
      canAttach: false,
      attachLabel: 'Remplacer le justificatif',
      canView: true,
    });
  });

  it.each(['confirmed', 'rejected'] as const)('%s without document → nothing', (statut) => {
    const aff = justificatifAffordances({ statut, has_document: false });
    expect(aff.canAttach).toBe(false);
    expect(aff.canView).toBe(false);
  });

  it.each(['bon_issued', 'bon_returned'] as const)(
    'FCT1 — a bon row (%s) never offers the justificatif attach',
    (statut) => {
      const aff = justificatifAffordances({ statut, has_document: false });
      expect(aff.canAttach).toBe(false);
      expect(aff.canView).toBe(false);
    },
  );
});

describe('isJustificatifTooLarge (client pre-check mirroring the server 10 Mo cap)', () => {
  it('accepts exactly 10 Mo, rejects one byte over', () => {
    expect(isJustificatifTooLarge({ size: MAX_JUSTIFICATIF_BYTES })).toBe(false);
    expect(isJustificatifTooLarge({ size: MAX_JUSTIFICATIF_BYTES + 1 })).toBe(true);
  });
});
