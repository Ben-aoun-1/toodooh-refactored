import { describe, expect, it } from 'vitest';

import { adminKeys } from './queryKeys';

describe('adminKeys', () => {
  it('namespaces every view key under the "admin" prefix', () => {
    expect(adminKeys.all).toEqual(['admin']);
    for (const key of [
      adminKeys.recharges('all', '', 1, 20),
      adminKeys.rechargeStats(),
      adminKeys.rechargeAdvertisers(),
      adminKeys.videos('all'),
      adminKeys.videoStats(),
      adminKeys.monitoringCampaigns(),
      adminKeys.monitoringStats(),
      adminKeys.monitoringCategories(),
      adminKeys.globalConfiguration(),
    ]) {
      expect(key[0]).toBe('admin');
      expect(key.slice(0, adminKeys.all.length)).toEqual(adminKeys.all);
    }
  });

  it('folds the recharge filters + pagination into the key', () => {
    expect(adminKeys.recharges('pending', 'acme', 2, 20)).toEqual([
      'admin',
      'recharges',
      'pending',
      'acme',
      2,
      20,
    ]);
    expect(adminKeys.recharges('all', '', 1, 20)).not.toEqual(
      adminKeys.recharges('all', '', 2, 20),
    );
  });

  it('keeps the recharges-all prefix a prefix of every recharge-list key', () => {
    const prefix = adminKeys.rechargesAll();
    const listKey = adminKeys.recharges('pending', '', 1, 20);
    expect(listKey.slice(0, prefix.length)).toEqual(prefix);
  });

  it('distinguishes the video list by status filter', () => {
    expect(adminKeys.videos('pending')).not.toEqual(adminKeys.videos('approved'));
  });
});
