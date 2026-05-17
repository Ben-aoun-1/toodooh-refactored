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
      adminKeys.users(),
      adminKeys.admins(),
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

  it('gives the user / admin account lists distinct, stable keys', () => {
    expect(adminKeys.users()).toEqual(['admin', 'users']);
    expect(adminKeys.admins()).toEqual(['admin', 'admins']);
    expect(adminKeys.users()).not.toEqual(adminKeys.admins());
  });

  it('keys the 6c catalog reads — events, platform stats, per-location affluence', () => {
    expect(adminKeys.events()).toEqual(['admin', 'events']);
    expect(adminKeys.platformStats()).toEqual(['admin', 'platformStats']);
    expect(adminKeys.affluenceSchedule('loc1')).toEqual(['admin', 'affluenceSchedule', 'loc1']);
    expect(adminKeys.affluenceSchedule('loc1')).not.toEqual(adminKeys.affluenceSchedule('loc2'));
    expect(adminKeys.adminLocations('all', 'all', '', 1, 20)).not.toEqual(
      adminKeys.adminLocations('all', 'all', '', 2, 20),
    );
  });
});
