import { describe, expect, it, vi } from 'vitest';

import type { RechargeRow } from '@/features/wallet/services/wallet.service';

import {
  MAX_JUSTIFICATIF_BYTES,
  createRechargeWithDocument,
  isJustificatifTooLarge,
  justificatifAffordances,
} from './recharge-document';

const row = (over: Partial<RechargeRow> = {}): RechargeRow => ({
  id: 'r1',
  amount_tnd: 1000,
  status: 'pending',
  reference: 'FCT-AAAA1111',
  reject_reason: null,
  confirmed_at: null,
  created_at: '2026-07-01T10:00:00.000Z',
  updated_at: '2026-07-01T10:00:00.000Z',
  has_document: false,
  document_uploaded_at: null,
  ...over,
});

const pdfFile = () => new File(['%PDF-1.4'], 'virement.pdf', { type: 'application/pdf' });

describe('createRechargeWithDocument (CF-M2 — the create-then-upload seam)', () => {
  it('no file → the created row, upload never called', async () => {
    const created = row();
    const deps = {
      createRecharge: vi.fn().mockResolvedValue(created),
      uploadJustificatif: vi.fn(),
    };
    await expect(createRechargeWithDocument(deps, 1000, null)).resolves.toEqual({
      recharge: created,
      documentError: false,
    });
    expect(deps.createRecharge).toHaveBeenCalledWith(1000);
    expect(deps.uploadJustificatif).not.toHaveBeenCalled();
  });

  it('file + both calls succeed → the UPDATED row (has_document true)', async () => {
    const created = row();
    const updated = row({ has_document: true, document_uploaded_at: '2026-07-01T10:01:00.000Z' });
    const deps = {
      createRecharge: vi.fn().mockResolvedValue(created),
      uploadJustificatif: vi.fn().mockResolvedValue(updated),
    };
    const file = pdfFile();
    await expect(createRechargeWithDocument(deps, 1000, file)).resolves.toEqual({
      recharge: updated,
      documentError: false,
    });
    expect(deps.uploadJustificatif).toHaveBeenCalledWith('r1', file);
  });

  it('document failure NEVER loses the created recharge — resolves with documentError', async () => {
    const created = row();
    const deps = {
      createRecharge: vi.fn().mockResolvedValue(created),
      uploadJustificatif: vi.fn().mockRejectedValue(new Error('minio down')),
    };
    await expect(createRechargeWithDocument(deps, 1000, pdfFile())).resolves.toEqual({
      recharge: created,
      documentError: true,
    });
  });

  it('create failure throws (nothing exists yet) and the upload never runs', async () => {
    const deps = {
      createRecharge: vi.fn().mockRejectedValue(new Error('api down')),
      uploadJustificatif: vi.fn(),
    };
    await expect(createRechargeWithDocument(deps, 1000, pdfFile())).rejects.toThrow('api down');
    expect(deps.uploadJustificatif).not.toHaveBeenCalled();
  });
});

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
});

describe('isJustificatifTooLarge (client pre-check mirroring the server 10 Mo cap)', () => {
  it('accepts exactly 10 Mo, rejects one byte over', () => {
    expect(isJustificatifTooLarge({ size: MAX_JUSTIFICATIF_BYTES })).toBe(false);
    expect(isJustificatifTooLarge({ size: MAX_JUSTIFICATIF_BYTES + 1 })).toBe(true);
  });
});
