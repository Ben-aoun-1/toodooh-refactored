import { describe, expect, it } from 'vitest';

import type { OwnerFactureRow } from '../services/factures.service';

import {
  CONSIGNE_LINE,
  REPLACE_NOTICE,
  SOURCE_LABEL_FALLBACK,
  TOODOOH_CLIENT_NAME,
  TVA_LABEL,
  depositHistory,
  depositPayload,
  factureChoices,
  factureLines,
  factureMoney,
  formatDateFr,
  formatTnd,
} from './facture-view';

// REV2 — the owner facture view model. apps/web has no render harness (vitest is environment:
// 'node' over src/**/*.test.ts), so every rule the surfaces must obey lives in this module and is
// pinned here rather than asserted against a DOM that cannot be mounted.

const row = (over: Partial<OwnerFactureRow> = {}): OwnerFactureRow => ({
  id: 'f1',
  screenhost_id: 'v1',
  screenhost_name: 'Café Lac 2',
  month: '2026-07',
  total_sh_tnd: 42.5,
  reference: 'FS-AAAA1111',
  created_at: '2026-08-01T06:00:00.000Z',
  deposited_at: null,
  designation: 'Facture juillet 2026',
  ...over,
});

describe('factureMoney (the trio the owner sees = the trio on the PDF)', () => {
  it('reproduces the api sweep exactly: 42.50 HT → 8.08 TVA → 50.58 TTC', () => {
    // The figure verified from the rendered document at commit 1.
    expect(factureMoney(42.5)).toEqual({ htTnd: 42.5, tvaTnd: 8.08, ttcTnd: 50.58 });
  });

  it('HT + TVA always equals TTC — TVA is the difference, never a second computation', () => {
    for (const ht of [0, 1, 7.77, 100, 1234.56, 9999.99]) {
      const { htTnd, tvaTnd, ttcTnd } = factureMoney(ht);
      expect(Math.round((htTnd + tvaTnd) * 100) / 100).toBe(ttcTnd);
    }
  });

  it('total_sh_tnd IS the sous-total HT (the sweep stores Σ sh_amount_tnd)', () => {
    expect(factureMoney(120).htTnd).toBe(120);
  });

  it('the TVA label reads the rate from lib/money — never a second 19 % in the codebase', () => {
    expect(TVA_LABEL).toBe('TVA (19 %)');
  });
});

describe('factureLines (the detail screen line table)', () => {
  it('prints one line at the exact facture HT — the total on screen equals the total on the PDF', () => {
    expect(factureLines(row({ total_sh_tnd: 42.5 }))).toEqual([
      { label: SOURCE_LABEL_FALLBACK, amountHtTnd: 42.5 },
    ]);
  });

  it('uses the neutral wording — the per-source split is not on the owner wire', () => {
    expect(SOURCE_LABEL_FALLBACK).toBe('Revenus de diffusion');
  });
});

describe('§1 — no internals reach the owner', () => {
  it('no rate, share, barème or score appears in any exported string', () => {
    const strings = [
      CONSIGNE_LINE,
      REPLACE_NOTICE,
      SOURCE_LABEL_FALLBACK,
      TOODOOH_CLIENT_NAME,
      TVA_LABEL,
      formatTnd(42.5),
    ].join(' ');
    for (const leak of [
      '50 %',
      '50%',
      'barème',
      'Part établissement',
      'CPM',
      'SPS',
      'épartition',
    ]) {
      expect(strings).not.toContain(leak);
    }
  });
});

describe('§5 — statuses never reach a line', () => {
  it('the deposit history carries a name and a date, and nothing else', () => {
    const history = depositHistory([
      row({ id: 'a', deposited_at: '2026-08-02T10:00:00.000Z' }),
      row({ id: 'b', deposited_at: null }),
      row({ id: 'c', deposited_at: '2026-08-05T10:00:00.000Z', designation: 'Facture juin 2026' }),
    ]);
    // Newest deposit first; the undeposited facture is absent.
    expect(history.map((h) => h.id)).toEqual(['c', 'a']);
    expect(Object.keys(history[0]).sort()).toEqual([
      'depositedAt',
      'designation',
      'id',
      'venueName',
    ]);
    expect(JSON.stringify(history)).not.toContain('status');
    expect(JSON.stringify(history)).not.toContain('verification');
  });

  it('a facture that is en_verification server-side is indistinguishable here from any other', () => {
    // The wire has no `status` key at all — the only deposit signal is the date.
    const projected = factureChoices([row({ deposited_at: '2026-08-02T10:00:00.000Z' })]);
    expect(JSON.stringify(projected)).not.toContain('status');
    expect(Object.keys(projected[0]).sort()).toEqual([
      'designation',
      'id',
      'reference',
      'venueName',
    ]);
  });
});

describe('factureChoices (« Choisir la facture concernée »)', () => {
  it('offers every facture by name — including an already-deposited one, since re-deposit is supported', () => {
    const choices = factureChoices([
      row({ id: 'a' }),
      row({ id: 'b', deposited_at: '2026-08-02T10:00:00.000Z' }),
    ]);
    expect(choices.map((c) => c.id)).toEqual(['a', 'b']);
    expect(choices[0].designation).toBe('Facture juillet 2026');
  });
});

describe('depositPayload (the file attaches to THAT facture)', () => {
  const file = new File(['%PDF-1.3'], 'facture-signee.pdf', { type: 'application/pdf' });

  it('carries the id the owner picked in step 1', () => {
    expect(depositPayload('f2', file)).toEqual({ id: 'f2', file });
  });

  it('refuses to build an upload with no facture chosen — nothing can be guessed onto a month', () => {
    expect(depositPayload(null, file)).toBeNull();
  });

  it('refuses to build an upload with no file', () => {
    expect(depositPayload('f2', undefined)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats a montant in TND with two decimals', () => {
    expect(formatTnd(50.58)).toContain('50,58');
    expect(formatTnd(50.58)).toContain('TND');
  });

  it('renders an ISO instant as dd/mm/yyyy, and echoes an unparseable one rather than faking it', () => {
    expect(formatDateFr('2026-08-01T06:00:00.000Z')).toBe('01/08/2026');
    expect(formatDateFr('nope')).toBe('nope');
  });
});
