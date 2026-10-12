import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// CF-U4 — the money-format sweep (the source-scan idiom, like map-layering.test.ts): every
// displayed montant rides lib/money (fr locale, HT (TTC) — CF-U1's convention). A raw en-US
// Intl money formatter can never come back; the two audited miss sites are pinned onto the
// house formatter.

const WEB_SRC = join(__dirname, '..');

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) acc.push(full);
  }
  return acc;
};

describe('the money-format sweep', () => {
  it("no advertiser-facing source formats money with an en-US Intl (the StatsGrid miss can't return)", () => {
    const offenders = walk(join(WEB_SRC, 'features')).filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes("NumberFormat('en-US'");
    });
    expect(offenders).toEqual([]);
  });

  it('the two audited sites ride the house formatter', () => {
    const statsGrid = readFileSync(
      join(WEB_SRC, 'features', 'advertiser', 'components', 'dashboard', 'StatsGrid.tsx'),
      'utf8',
    );
    expect(statsGrid).toContain('tndOrDash(totalBudget)');
    expect(statsGrid).not.toContain('en-US');

    // CART-V1 — the cart montants moved into the two docked forms; both stay on the formatter.
    for (const file of ['CartDockBar.tsx', 'CartEdgeTab.tsx']) {
      const source = readFileSync(join(WEB_SRC, 'features', 'cart', 'components', file), 'utf8');
      expect(source).toContain('tndOrDash(item.requested_budget)');
      expect(source).not.toMatch(/\$\{item\.requested_budget\} TND/);
    }
  });

  // HT-1 (operator, 2026-10-02): the screencaster sees every amount HT WITHOUT the HT/TTC letters.
  // Operator 2026-10-12 widens it to EVERY app screen (screenhost, admin, recharge, Mes factures):
  // a montant is plain « 1 234 TND ». Only the invoice-detail screens, which mirror the issued
  // document line by line (HT / TVA / TTC), keep the letters.
  it('no app screen renders « TTC » outside the invoice-detail screens', () => {
    const allowed = new Set([
      join('screenhost', 'pages', 'OwnerFactureDetailPage.tsx'),
      join('wallet', 'components', 'MonthlyInvoicesSection.tsx'),
    ]);
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const offenders = walk(join(WEB_SRC, 'features'))
      .filter((file) => !allowed.has(file.slice(join(WEB_SRC, 'features').length + 1)))
      .filter((file) =>
        /\bTTC\b|'TND HT'|TND HT \(/.test(stripComments(readFileSync(file, 'utf8'))),
      );
    expect(offenders).toEqual([]);
  });
});
