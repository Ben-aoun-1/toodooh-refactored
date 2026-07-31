import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// REV2 — the terminology + leak sweep (the source-scan idiom, like money-sweep.test.ts).
//
// « Toujours facture, jamais relevé ». The document a screenhost receives is a FACTURE they issue
// to Toodooh; « relevé de reversement » is FCT2 vocabulary and must not survive anywhere the owner
// can read it. COMMENTS ARE EXEMPT and deliberately so: the header of factures.service.ts explains
// that this supersedes the relevés, and deleting that sentence would delete the reason the rename
// happened. What is pinned is what RENDERS.
//
// The « relevé d'identité bancaire » (RIB) is a different French term for a different document and
// is correct where it appears — it is allowlisted, not swept.

const WEB_SRC = join(__dirname, '..', '..');
const FEATURES = join(WEB_SRC, 'features');

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) acc.push(full);
  }
  return acc;
};

/** Comments carry the lane's history; only rendered source is swept. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const RIB_PHRASE = /relev[ée]s?\s+(?:d(?:’|'|&apos;)identit[ée]\s+bancaire|bancaire)/gi;
const RELEVE_TOKEN = /\brelev[ée]s?\b/i;

const FACTURE_SURFACES = [
  join(FEATURES, 'screenhost', 'pages', 'OwnerFacturesPage.tsx'),
  join(FEATURES, 'screenhost', 'pages', 'OwnerFactureDetailPage.tsx'),
  join(FEATURES, 'screenhost', 'components', 'OwnerFactureDepositSlot.tsx'),
  join(FEATURES, 'screenhost', 'lib', 'facture-view.ts'),
];

describe('REV2 — the terminology sweep', () => {
  it('no rendered source says « relevé » (the RIB is a different document and is allowlisted)', () => {
    const offenders = walk(FEATURES)
      .map((file) => ({
        file,
        src: stripComments(readFileSync(file, 'utf8')).replace(RIB_PHRASE, ''),
      }))
      .filter(({ src }) => RELEVE_TOKEN.test(src))
      .map(({ file }) => file.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the owner reaches the factures list at /owner-factures', () => {
    const app = readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8');
    expect(app).toContain('path="/owner-factures"');
    expect(app).toContain('path="/owner-factures/:id"');
    // The pre-rename URL still resolves — bookmarks and already-sent links keep working.
    expect(app).toContain(
      '<Route path="/owner-statements" element={<Navigate to="/owner-factures"',
    );
  });

  it('« Mes Revenus » links to « Mes factures », not to a relevé', () => {
    const revenue = readFileSync(join(FEATURES, 'screenhost', 'pages', 'OwnerRevenue.tsx'), 'utf8');
    expect(revenue).toContain('Mes factures');
    expect(revenue).toContain("navigate('/owner-factures')");
    // The deposit slot sits between the revenue block and the transactions history.
    const slotAt = revenue.indexOf('<OwnerFactureDepositSlot />');
    expect(slotAt).toBeGreaterThan(revenue.indexOf('Revenu actuel'));
    expect(slotAt).toBeLessThan(revenue.indexOf('Dernières transactions'));
  });
});

describe('REV2 — §5: statuses live in notifications, never on a line', () => {
  it('no facture surface renders a status value', () => {
    for (const file of FACTURE_SURFACES) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const status of ['emise', 'en_verification', 'en_paiement', 'refusee', 'payee']) {
        expect(src).not.toContain(status);
      }
      expect(src).not.toMatch(/\brow\.status\b|\bfacture\.status\b/);
    }
  });

  it('the owner wire type declares no status field', () => {
    const service = readFileSync(
      join(FEATURES, 'screenhost', 'services', 'factures.service.ts'),
      'utf8',
    );
    const iface = service.slice(
      service.indexOf('export interface OwnerFactureRow'),
      service.indexOf('export const factureFilename'),
    );
    expect(iface).not.toContain('status');
  });

  it('all three facture notification types have an action path (the legacy one is KEPT)', () => {
    const hook = readFileSync(
      join(FEATURES, 'screenhost', 'hooks', 'useOwnerNotifications.ts'),
      'utf8',
    );
    for (const type of [
      'screenhost_facture_ready',
      'screenhost_facture_deposited',
      'reversement_statement_ready',
    ]) {
      expect(hook).toContain(type);
    }
  });
});

describe('REV2 — §1: no internals on an owner surface', () => {
  it('no facture surface mentions a rate, a split, a barème or a score', () => {
    for (const file of FACTURE_SURFACES) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const leak of [
        '50 %',
        '50%',
        'barème',
        'bareme',
        'Part établissement',
        'CPM',
        'SPS',
        'répartition',
        'reversement',
      ]) {
        expect(src).not.toContain(leak);
      }
    }
  });
});
