import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Operator 2026-10-12 — the screenhost's « Dernières transactions » are revenues only, so the
// Tous / Recharges / Dépenses toggle (inherited from the screencaster wallet) is gone; the search
// stays. apps/web has no render harness, so the page source is scanned (comments stripped).

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const page = stripComments(readFileSync(join(__dirname, 'pages', 'OwnerRevenue.tsx'), 'utf8'));

describe('Mes finances (screenhost) — Dernières transactions', () => {
  it('offers no Recharges / Dépenses filter', () => {
    expect(page).not.toContain('Dépenses');
    expect(page).not.toContain("'depenses'");
    expect(page).not.toContain("'recharges'");
    expect(page).not.toContain('txFilter');
  });

  it('keeps the search', () => {
    expect(page).toContain('placeholder="Rechercher.."');
    expect(page).toContain('setTxSearch');
  });
});
