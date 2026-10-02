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
  // TTC is allowed only where they pay (the recharge modal + its minimum-amount copy) and in the
  // documents issued after paying (« Mes factures »).
  it('HT-1 — no screencaster screen uses the HT (TTC) formatters outside payment + documents', () => {
    const allowed = new Set([
      join('wallet', 'components', 'NewRechargeModal.tsx'),
      join('wallet', 'lib', 'recharge-methods.ts'),
      join('wallet', 'pages', 'MyInvoices.tsx'),
    ]);
    const offenders = ['campaigns', 'cart', 'events', 'advertiser', 'wallet']
      .flatMap((feature) => walk(join(WEB_SRC, 'features', feature)))
      .filter((file) => !allowed.has(file.slice(join(WEB_SRC, 'features').length + 1)))
      .filter((file) =>
        /\b(htTtcLabel|htTtcOrDash|ttcParenthetical)\(|'TND HT'|TND HT \(/.test(
          readFileSync(file, 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
