import { describe, expect, it } from 'vitest';

import type { ApiNotification } from '@/services/notifications.service';

import { POLL_INTERVAL_MS, actionFor, toFeed } from './useAdminNotifications';

const notif = (over: Partial<ApiNotification> = {}): ApiNotification => ({
  id: 'n1',
  type: 'admin_account_pending',
  title: 'T',
  body: 'B',
  campaign_id: null,
  read_at: null,
  created_at: '2026-09-12T10:00:00.000Z',
  ...over,
});

// ADM-BELL1 — the admin bell's routing: every admin_* type opens its queue; unknown → no CTA.
describe('actionFor (admin bell CTA)', () => {
  it.each([
    ['recharge_action_required', '/admin-recharges', 'Traiter'],
    ['admin_account_pending', '/admin-users', 'Traiter'],
    ['admin_campaign_pending', '/admin-campaigns', 'Traiter'],
    ['admin_creative_pending', '/admin-creatives', 'Traiter'],
    ['admin_facture_deposited', '/admin-screenhost-factures', 'Traiter'],
    ['admin_allocation_refused', '/admin-campaigns', 'Consulter'],
  ])('%s → %s', (type, path, label) => {
    expect(actionFor(notif({ type }))).toEqual({ label, path });
  });

  it('an unknown type gets NO CTA (renders plainly, forward-compatible)', () => {
    expect(actionFor(notif({ type: 'something_new' }))).toBeNull();
  });
});

describe('toFeed', () => {
  it('derives readIds from read_at and keeps the server type as kind', () => {
    const feed = toFeed([notif({ id: 'a' }), notif({ id: 'b', read_at: '2026-09-12T11:00:00Z' })]);
    expect(feed.items.map((i) => i.kind)).toEqual([
      'admin_account_pending',
      'admin_account_pending',
    ]);
    expect(feed.readIds).toEqual(['b']);
  });

  it('polls at the same cadence as the other bells', () => {
    expect(POLL_INTERVAL_MS).toBe(60_000);
  });
});
