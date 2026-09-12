import { describe, expect, it } from 'vitest';

import {
  CSP_CHARACTERISTIC_MIN_PCT,
  HISTORY_PAGE_SIZE,
  HISTORY_NO_MATCH,
  LIVE_FOLD,
  OPPORTUNITY_CARDS,
  OPPORTUNITIES_INTRO,
  WAITING_TITLE,
  ZONE_LOW_COVERAGE_PCT,
  awaitingFirstClosure,
  barWidthPct,
  budgetLabel,
  budgetTtcNote,
  cspCharacteristics,
  filterHistory,
  isLowCoverage,
  listOrDash,
  liveFold,
  pageOf,
  paginate,
  readsState,
  voirPlusLabel,
} from './performances-derive';

const NBSP = ' ';

describe('SC-P — the Annexe A hypotheses live as named constants', () => {
  it('Q5 10/page · Q7 ≥ 12 % · zone < 5 % · US-1.2 fold at 3', () => {
    expect(HISTORY_PAGE_SIZE).toBe(10);
    expect(CSP_CHARACTERISTIC_MIN_PCT).toBe(12);
    expect(ZONE_LOW_COVERAGE_PCT).toBe(5);
    expect(LIVE_FOLD).toBe(3);
  });
});

describe('epic 1 — the live fold (US-1.2)', () => {
  it('shows 3 then « Voir plus (n) »; expanded shows all; ≤ 3 has no fold', () => {
    const four = ['a', 'b', 'c', 'd'];
    expect(liveFold(four, false)).toEqual({ visible: ['a', 'b', 'c'], hidden: 1 });
    expect(liveFold(four, true)).toEqual({ visible: four, hidden: 0 });
    expect(liveFold(['a'], false)).toEqual({ visible: ['a'], hidden: 0 });
    expect(voirPlusLabel(1)).toBe('Voir plus (1)');
  });
});

describe('epic 4 — history search, nature filter, pagination (RG-PERF-10, Q5)', () => {
  const rows = [
    { id: '1', name: "Soldes d'Été 2026", nature: 'normal' as const },
    { id: '2', name: 'Coupe du Monde', nature: 'event' as const },
    { id: '3', name: 'Fête de la Musique', nature: 'event' as const },
  ];

  it('search is accent- and case-insensitive; nature restricts', () => {
    expect(filterHistory(rows, 'ete', 'all').map((r) => r.id)).toEqual(['1', '3']);
    expect(filterHistory(rows, 'FÊTE', 'all').map((r) => r.id)).toEqual(['3']);
    expect(filterHistory(rows, '', 'event').map((r) => r.id)).toEqual(['2', '3']);
    expect(filterHistory(rows, 'soldes', 'event')).toEqual([]);
    expect(HISTORY_NO_MATCH).toBe('Aucune campagne ne correspond à votre recherche.');
  });

  it('paginates 10 per page, clamps the page, and finds the page of a row', () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ id: `c${i + 1}` }));
    expect(paginate(many, 1)).toMatchObject({ page: 1, pageCount: 3, total: 23 });
    expect(paginate(many, 1).rows).toHaveLength(10);
    expect(paginate(many, 3).rows.map((r) => r.id)).toEqual(['c21', 'c22', 'c23']);
    expect(paginate(many, 99).page).toBe(3);
    expect(paginate(many, 0).page).toBe(1);
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pageCount: 1, total: 0 });
    expect(pageOf(many, 'c11')).toBe(2);
    expect(pageOf(many, 'nope')).toBeNull();
  });
});

describe('epic 7 — the thresholds', () => {
  it('Q7 — CSP classes at ≥ 12 % are characteristics; the boundary is inclusive', () => {
    expect(
      cspCharacteristics([
        { key: 'populaire', label: 'Populaire', value: 46, pct: 46 },
        { key: 'moyen', label: 'Moyen', value: 42, pct: 42 },
        { key: 'premium', label: 'Premium', value: 12, pct: 12 },
      ]),
    ).toEqual(['Populaire', 'Moyen', 'Premium']);
    expect(
      cspCharacteristics([{ key: 'premium', label: 'Premium', value: 11.9, pct: 11.9 }]),
    ).toEqual([]);
    expect(listOrDash([])).toBe('—');
    expect(listOrDash(['Cafés', 'Restaurants'])).toBe('Cafés, Restaurants');
  });

  it('zone « peu couverte » strictly under 5 %', () => {
    expect(isLowCoverage(4.9)).toBe(true);
    expect(isLowCoverage(5)).toBe(false);
    expect(isLowCoverage(0)).toBe(true);
  });

  it('bars are relative to the set’s max; an all-zero set is flat', () => {
    const rows = [{ value: 200 }, { value: 50 }];
    expect(barWidthPct(50, rows)).toBe(25);
    expect(barWidthPct(200, rows)).toBe(100);
    expect(barWidthPct(0, [{ value: 0 }])).toBe(0);
  });
});

describe('epic 8 — RG-PERF-30 every montant HT with the TTC in parentheses (money.ts home)', () => {
  it('formats through htTtcLabel / ttcParenthetical', () => {
    expect(budgetLabel(2200)).toBe(`2${NBSP}200 TND HT (2${NBSP}618 TND TTC)`);
    expect(budgetTtcNote(1500)).toBe(`(1${NBSP}785 TND TTC)`);
  });
});

describe('waiting states (US-3.2 / 4.3 / 5.2 / 6.6) + the INV-1 reads gate', () => {
  it('awaiting = no closed campaign at all; copy is simulator B’s', () => {
    expect(awaitingFirstClosure(0)).toBe(true);
    expect(awaitingFirstClosure(1)).toBe(false);
    expect(WAITING_TITLE).toBe('En attente de la clôture de votre première campagne.');
  });

  it('readsState — error beats loading beats ready', () => {
    expect(
      readsState([
        { pending: true, error: false },
        { pending: false, error: true },
      ]),
    ).toBe('error');
    expect(
      readsState([
        { pending: true, error: false },
        { pending: false, error: false },
      ]),
    ).toBe('loading');
    expect(readsState([{ pending: false, error: false }])).toBe('ready');
    expect(readsState([])).toBe('ready');
  });
});

describe('epic 9 — « Prochaines opportunités » is static (US-9.1 / US-9.2)', () => {
  it('exactly three cards, in the spec’s order, with the PDF copy; a generic-pistes intro', () => {
    expect(OPPORTUNITY_CARDS.map((c) => c.title)).toEqual([
      'Échelle de campagne',
      'Mix premium',
      'Qualité créative',
    ]);
    expect(OPPORTUNITY_CARDS[0]?.body).toBe(
      'Augmenter les impressions prévues pour élargir la portée.',
    );
    expect(OPPORTUNITY_CARDS[2]?.body).toContain('QR code');
    expect(OPPORTUNITIES_INTRO).toContain('Quelques pistes pour renforcer');
    // The maquette's 4th card is excluded.
    expect(OPPORTUNITY_CARDS.some((c) => /couverture des lieux/i.test(c.title))).toBe(false);
  });
});
