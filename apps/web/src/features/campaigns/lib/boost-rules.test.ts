import { describe, expect, it } from 'vitest';

import {
  BOOST_SUCCESS_TOAST,
  WHOLE_NETWORK_AXIS_NOTE,
  boostReasonFr,
  canBoostCampaign,
  hasBoostAddition,
  newOptions,
} from './boost-rules';

// CF-B1 (spec §3.3) — the Booster's client rules.

describe('canBoostCampaign — the CF-Q1 disabled state retires on exactly two statuses', () => {
  it.each(['active', 'upcoming'])('%s boosts', (status) => {
    expect(canBoostCampaign(status)).toBe(true);
  });
  it.each(['draft', 'pending', 'rejected', 'completed'])('%s does NOT boost', (status) => {
    expect(canBoostCampaign(status)).toBe(false);
  });
});

describe('hasBoostAddition — at least ONE addition among the three', () => {
  const end = '2026-08-01';
  it('a LATER end date is an addition; the SAME date is not; none at all is not', () => {
    expect(hasBoostAddition({ new_end_date: '2026-08-05' }, end)).toBe(true);
    expect(hasBoostAddition({ new_end_date: end }, end)).toBe(false);
    expect(hasBoostAddition({}, end)).toBe(false);
  });
  it('zones or categories alone are additions', () => {
    expect(hasBoostAddition({ added_zone_ids: ['z1'] }, end)).toBe(true);
    expect(hasBoostAddition({ added_category_ids: ['c1'] }, end)).toBe(true);
    expect(hasBoostAddition({ added_zone_ids: [], added_category_ids: [] }, end)).toBe(false);
  });
});

describe('newOptions — the pickers offer ONLY what is not already targeted', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('excludes existing ids and tolerates null/undefined in the existing list', () => {
    expect(newOptions(all, ['b', null, undefined])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(newOptions(all, [])).toEqual(all);
    expect(newOptions(all, ['a', 'b', 'c'])).toEqual([]);
  });
});

describe('the French wording', () => {
  it('every refusal code speaks French (fallback included)', () => {
    for (const code of [
      'NOT_BOOSTABLE',
      'NO_ADDITION',
      'INVALID_END_DATE',
      'ZONES_WHOLE_NETWORK',
      'CATEGORIES_WHOLE_NETWORK',
      'BUDGET_BELOW_MINIMUM',
      'BUDGET_EXCEEDS_CMAX',
      'INSUFFICIENT_BALANCE',
      'TOO_THIN',
      'NO_ELIGIBLE',
    ]) {
      expect(boostReasonFr(code)).not.toBe('Le boost a été refusé.');
    }
    expect(boostReasonFr('SOMETHING_ELSE')).toBe('Le boost a été refusé.');
  });
  it('the success toast and the whole-network note are the ruled copy', () => {
    expect(BOOST_SUCCESS_TOAST).toBe(
      'Campagne boostée — les nouveaux emplacements attendent l’accord des établissements.',
    );
    expect(WHOLE_NETWORK_AXIS_NOTE).toContain('tout le réseau');
  });
});
