import { describe, expect, it } from 'vitest';

import { walletKeys } from './queryKeys';

describe('walletKeys', () => {
  it('namespaces every view key under the "wallet" prefix', () => {
    expect(walletKeys.all).toEqual(['wallet']);
    expect(walletKeys.balance('u1')[0]).toBe('wallet');
    expect(walletKeys.recharges('u1')[0]).toBe('wallet');
    expect(walletKeys.revenueStats('u1')[0]).toBe('wallet');
    expect(walletKeys.revenueByPeriod('u1', 'monthly')[0]).toBe('wallet');
  });

  it('builds hierarchical [feature, view, ...args] tuples', () => {
    expect(walletKeys.balance('u1')).toEqual(['wallet', 'balance', 'u1']);
    expect(walletKeys.recharges('u1')).toEqual(['wallet', 'recharges', 'u1']);
    expect(walletKeys.revenueStats('u1')).toEqual(['wallet', 'revenueStats', 'u1']);
    expect(walletKeys.revenueByPeriod('u1', 'monthly')).toEqual([
      'wallet',
      'revenueByPeriod',
      'u1',
      'monthly',
    ]);
  });

  it('distinguishes keys by user so caches stay isolated', () => {
    expect(walletKeys.balance('u1')).not.toEqual(walletKeys.balance('u2'));
    expect(walletKeys.balance('u1')).not.toEqual(walletKeys.recharges('u1'));
    expect(walletKeys.revenueStats('u1')).not.toEqual(walletKeys.revenueStats('u2'));
  });

  it('distinguishes revenue series by period bucket', () => {
    expect(walletKeys.revenueByPeriod('u1', 'monthly')).not.toEqual(
      walletKeys.revenueByPeriod('u1', 'yearly'),
    );
  });

  it('FCT2 — the adjustments/invoices keys join the factory, user-isolated', () => {
    expect(walletKeys.adjustments('u1')).toEqual(['wallet', 'adjustments', 'u1']);
    expect(walletKeys.invoices('u1')).toEqual(['wallet', 'invoices', 'u1']);
    expect(walletKeys.adjustments('u1')).not.toEqual(walletKeys.adjustments('u2'));
  });

  it('keeps every view key prefix-matchable by walletKeys.all', () => {
    for (const key of [
      walletKeys.balance('u1'),
      walletKeys.recharges('u1'),
      walletKeys.revenueStats('u1'),
      walletKeys.revenueByPeriod('u1', 'monthly'),
      walletKeys.adjustments('u1'),
      walletKeys.invoices('u1'),
    ]) {
      expect(key.slice(0, walletKeys.all.length)).toEqual(walletKeys.all);
    }
  });
});
