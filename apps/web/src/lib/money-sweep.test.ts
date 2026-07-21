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
    expect(statsGrid).toContain('htTtcOrDash(totalBudget)');
    expect(statsGrid).not.toContain('en-US');

    const cartWidget = readFileSync(
      join(WEB_SRC, 'features', 'cart', 'components', 'CartWidget.tsx'),
      'utf8',
    );
    expect(cartWidget).toContain('htTtcOrDash(item.requested_budget)');
    expect(cartWidget).not.toMatch(/\$\{item\.requested_budget\} TND/);
  });
});
