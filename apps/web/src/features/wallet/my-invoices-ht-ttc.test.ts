import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ttcFromHt } from '@/lib/money';

// Operator 2026-10-12 — the screencaster's « Mes factures » ALWAYS shows HT and TTC (both tables:
// the monthly invoices and the per-recharge récapitulatifs); every other screencaster screen shows
// the HT figure alone, without letters.

const src = (...p: string[]): string => readFileSync(join(__dirname, ...p), 'utf8');

describe('Mes factures — HT and TTC', () => {
  it('the récapitulatifs table has a « Montant HT » and a « Montant TTC » column', () => {
    const page = src('pages', 'MyInvoices.tsx');
    expect(page).toContain('Montant HT');
    expect(page).toContain('Montant TTC');
    expect(page).toContain('{tndLabel(ttcFromHt(facture.montant))}');
    expect(ttcFromHt(500)).toBe(595);
  });

  it('the monthly invoices table keeps its HT and TTC columns', () => {
    const section = src('components', 'MonthlyInvoicesSection.tsx');
    expect(section).toContain('Total TTC');
    expect(section).toContain('invoice.total_ttc');
  });
});
