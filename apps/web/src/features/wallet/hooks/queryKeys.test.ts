import { describe, expect, it } from 'vitest';

import { walletKeys } from './queryKeys';

describe('walletKeys', () => {
  it('namespaces every view key under the "wallet" prefix', () => {
    expect(walletKeys.all).toEqual(['wallet']);
    expect(walletKeys.transactions('u1')[0]).toBe('wallet');
    expect(walletKeys.invoices('u1')[0]).toBe('wallet');
    expect(walletKeys.revenueStats('u1')[0]).toBe('wallet');
    expect(walletKeys.revenueByPeriod('u1', 'monthly')[0]).toBe('wallet');
  });

  it('builds hierarchical [feature, view, ...args] tuples', () => {
    expect(walletKeys.transactions('u1')).toEqual(['wallet', 'transactions', 'u1']);
    expect(walletKeys.invoices('u1')).toEqual(['wallet', 'invoices', 'u1']);
    expect(walletKeys.revenueStats('u1')).toEqual(['wallet', 'revenueStats', 'u1']);
    expect(walletKeys.revenueByPeriod('u1', 'monthly')).toEqual([
      'wallet',
      'revenueByPeriod',
      'u1',
      'monthly',
    ]);
  });

  it('distinguishes keys by user so caches stay isolated', () => {
    expect(walletKeys.transactions('u1')).not.toEqual(walletKeys.transactions('u2'));
    expect(walletKeys.transactions('u1')).not.toEqual(walletKeys.invoices('u1'));
    expect(walletKeys.revenueStats('u1')).not.toEqual(walletKeys.revenueStats('u2'));
  });

  it('distinguishes revenue series by period bucket', () => {
    expect(walletKeys.revenueByPeriod('u1', 'monthly')).not.toEqual(
      walletKeys.revenueByPeriod('u1', 'yearly'),
    );
  });

  it('keeps every view key prefix-matchable by walletKeys.all', () => {
    for (const key of [
      walletKeys.transactions('u1'),
      walletKeys.invoices('u1'),
      walletKeys.revenueStats('u1'),
      walletKeys.revenueByPeriod('u1', 'monthly'),
    ]) {
      expect(key.slice(0, walletKeys.all.length)).toEqual(walletKeys.all);
    }
  });
});
