import { describe, expect, it } from 'vitest';

import { walletKeys } from './queryKeys';

describe('walletKeys', () => {
  it('namespaces every view key under the "wallet" prefix', () => {
    expect(walletKeys.all).toEqual(['wallet']);
    expect(walletKeys.transactions('u1')[0]).toBe('wallet');
    expect(walletKeys.invoices('u1')[0]).toBe('wallet');
  });

  it('builds hierarchical [feature, view, ...args] tuples', () => {
    expect(walletKeys.transactions('u1')).toEqual(['wallet', 'transactions', 'u1']);
    expect(walletKeys.invoices('u1')).toEqual(['wallet', 'invoices', 'u1']);
  });

  it('distinguishes keys by user so caches stay isolated', () => {
    expect(walletKeys.transactions('u1')).not.toEqual(walletKeys.transactions('u2'));
    expect(walletKeys.transactions('u1')).not.toEqual(walletKeys.invoices('u1'));
  });

  it('keeps every view key prefix-matchable by walletKeys.all', () => {
    for (const key of [walletKeys.transactions('u1'), walletKeys.invoices('u1')]) {
      expect(key.slice(0, walletKeys.all.length)).toEqual(walletKeys.all);
    }
  });
});
