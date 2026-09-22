import { describe, expect, it } from 'vitest';

import { campaignsKeys } from '../hooks/queryKeys';
import type { ImpressionsEstimateRead } from '../services/campaigns.api';

import { CAMPAIGN_STATUS_IDS } from './campaign-status';
import {
  ESTIMATE_ERROR_REASON,
  ESTIMATE_LOADING_TEXT,
  ESTIMATE_NONE_TEXT,
  ESTIMATE_NO_DISPATCH_REASON,
  ESTIMATE_REASONS,
  PRE_DISPATCH_STATUSES,
  estimateInputsKey,
  estimateView,
  isEstimableStatus,
} from './impressions-estimate';

// IMP-EST1 (ruled Q1 A · Q2 A · Q3 A) — « Impressions estimées » = the server's dry-run of the real
// dispatch. THE view rule every surface renders: « … » while loading, the number, or « — » WITH the
// reason — never a 0 standing in for « no estimate ».

const ok = (impressions: number): ImpressionsEstimateRead => ({
  status: 'ok',
  source: 'simulation',
  impressions,
  venues_count: 2,
  days_count: 30,
});

const refused = (status: Exclude<ImpressionsEstimateRead['status'], 'ok'>) => ({
  status,
  source: null,
  impressions: null,
  venues_count: null,
  days_count: null,
});

const settled = { budgetUnset: false, pending: false, isError: false };

describe('estimateView — loading / value / reason', () => {
  it('loading (a request in flight or the cursor still moving) renders « … »', () => {
    expect(estimateView({ ...settled, pending: true, data: undefined })).toEqual({
      kind: 'loading',
      text: ESTIMATE_LOADING_TEXT,
      reason: null,
    });
    expect(ESTIMATE_LOADING_TEXT).toBe('…');
    // A previous answer never shows through while the new inputs compute.
    expect(estimateView({ ...settled, pending: true, data: ok(48_000) }).text).toBe('…');
  });

  it('a value renders the fr-grouped integer; a real 0 from the dry-run stays 0', () => {
    expect(estimateView({ ...settled, data: ok(48_000) })).toEqual({
      kind: 'value',
      text: '48 000',
      reason: null,
      impressions: 48_000,
    });
    expect(estimateView({ ...settled, data: ok(0) }).text).toBe('0');
  });

  it('every no-estimate status renders « — » with its reason, never a number', () => {
    for (const status of Object.keys(ESTIMATE_REASONS) as (keyof typeof ESTIMATE_REASONS)[]) {
      const view = estimateView({ ...settled, data: refused(status) });
      expect(view).toEqual({
        kind: 'none',
        text: ESTIMATE_NONE_TEXT,
        reason: ESTIMATE_REASONS[status],
      });
      expect(view.reason).not.toBe('');
    }
    expect(ESTIMATE_NONE_TEXT).toBe('—');
  });

  it('an untouched cursor asks nothing: « — » + « Budget à renseigner »', () => {
    expect(estimateView({ ...settled, budgetUnset: true, pending: true, data: undefined })).toEqual(
      {
        kind: 'none',
        text: '—',
        reason: ESTIMATE_REASONS.no_budget,
      },
    );
  });

  it('an error (or an ok without a figure) is « — » + the unavailable line, not 0', () => {
    expect(estimateView({ ...settled, isError: true, data: undefined })).toEqual({
      kind: 'none',
      text: '—',
      reason: ESTIMATE_ERROR_REASON,
    });
    expect(estimateView({ ...settled, data: { ...ok(1), impressions: null } }).reason).toBe(
      ESTIMATE_ERROR_REASON,
    );
  });
});

describe('only a pre-dispatch campaign is estimated', () => {
  it('draft / pending / upcoming are estimable; active, rejected and completed are not', () => {
    expect([...PRE_DISPATCH_STATUSES]).toEqual(['draft', 'pending', 'upcoming']);
    const estimable = CAMPAIGN_STATUS_IDS.filter(isEstimableStatus);
    expect(estimable).toEqual(['draft', 'pending', 'upcoming']);
    for (const status of ['active', 'rejected', 'completed']) {
      expect(isEstimableStatus(status), status).toBe(false);
    }
    // An unknown or absent status is never estimated (no request on a shape we do not know).
    expect(isEstimableStatus('archived')).toBe(false);
    expect(isEstimableStatus(null)).toBe(false);
    expect(isEstimableStatus(undefined)).toBe(false);
  });

  it('a non-estimable plan-less row renders « — » + its reason, never « … » nor a number', () => {
    // The request is not sent, so the query stays pending forever: the view must not show « … ».
    expect(
      estimateView({
        notEstimable: true,
        budgetUnset: false,
        pending: true,
        isError: false,
        data: undefined,
      }),
    ).toEqual({ kind: 'none', text: ESTIMATE_NONE_TEXT, reason: ESTIMATE_NO_DISPATCH_REASON });
    // Even a cached answer from an earlier status never resurfaces as a live figure.
    expect(estimateView({ ...settled, notEstimable: true, data: ok(48_000) }).text).toBe('—');
  });
});

describe('the query key recomputes the estimate live', () => {
  const base = {
    startDate: '2027-05-03',
    endDate: '2027-05-06',
    targeting: ['cafe:*', 'gym:premium'],
    zones: ['Grand Tunis', 'Sousse'],
    creativeId: 'cr1',
    creativeDurationSeconds: 10,
  };

  it('line and zone ORDER never changes the signature', () => {
    expect(
      estimateInputsKey({
        ...base,
        targeting: ['gym:premium', 'cafe:*'],
        zones: ['Sousse', 'Grand Tunis'],
      }),
    ).toBe(estimateInputsKey(base));
  });

  it('dates, targeting, zones, the spot and the stored budget each change it', () => {
    const k = estimateInputsKey(base);
    expect(estimateInputsKey({ ...base, endDate: '2027-05-12' })).not.toBe(k);
    expect(estimateInputsKey({ ...base, targeting: ['cafe:*'] })).not.toBe(k);
    expect(estimateInputsKey({ ...base, zones: [] })).not.toBe(k);
    expect(estimateInputsKey({ ...base, creativeId: 'cr2' })).not.toBe(k);
    expect(estimateInputsKey({ ...base, creativeDurationSeconds: 20 })).not.toBe(k);
    expect(estimateInputsKey({ ...base, storedBudget: 300 })).not.toBe(k);
  });

  it('the key carries the campaign, the cursor and the inputs signature', () => {
    const k = estimateInputsKey(base);
    expect(campaignsKeys.impressionsEstimate('c1', 150, k)).toEqual([
      'campaigns',
      'impressionsEstimate',
      'c1',
      150,
      k,
    ]);
    expect(campaignsKeys.impressionsEstimate('c1', 150, k)).not.toEqual(
      campaignsKeys.impressionsEstimate('c1', 151, k),
    );
    expect(campaignsKeys.impressionsEstimate('c1', 'stored', k)).not.toEqual(
      campaignsKeys.impressionsEstimate('c1', 'stored', estimateInputsKey({ ...base, zones: [] })),
    );
  });
});
