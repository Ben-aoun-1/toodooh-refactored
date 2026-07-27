import { describe, expect, it } from 'vitest';

import type { ApiNotification } from '@/services/notifications.service';

import { POLL_INTERVAL_MS, actionFor, toFeed } from './useAdvertiserNotifications';

const notif = (over: Partial<ApiNotification> = {}): ApiNotification => ({
  id: 'n1',
  type: 'campaign_draft_reminder',
  title: 'Votre campagne démarre bientôt',
  body: '',
  campaign_id: 'c1',
  read_at: null,
  created_at: '2026-07-10T08:00:00.000Z',
  ...over,
});

describe('actionFor (advertiser bell CTA routing by type)', () => {
  it('routes campaign_draft_reminder to the draft list (?status=draft)', () => {
    expect(actionFor(notif())).toEqual({
      label: 'Consulter',
      path: '/my-campaigns?status=draft',
    });
  });

  it('FCT1 — routes every recharge transition to the wallet (prefix-matched)', () => {
    for (const type of [
      'recharge_virement_created',
      'recharge_bon_issued',
      'recharge_bon_returned',
      'recharge_credited',
      'recharge_funds_received',
      'recharge_cancelled',
    ]) {
      expect(actionFor(notif({ type }))).toEqual({ label: 'Consulter', path: '/my-recharges' });
    }
  });

  it('FCT2 — the monthly facture routes to Mes factures; a solde adjustment to Mes finances', () => {
    expect(actionFor(notif({ type: 'monthly_invoice_ready' }))).toEqual({
      label: 'Consulter',
      path: '/my-invoices',
    });
    expect(actionFor(notif({ type: 'wallet_adjustment' }))).toEqual({
      label: 'Consulter',
      path: '/my-recharges',
    });
  });

  it('gives every unknown type NO CTA (rendered plainly, forward-compatible)', () => {
    for (const type of ['account_approved', 'video_approved', 'some_future_type']) {
      expect(actionFor(notif({ type }))).toBeNull();
    }
  });
});

describe('toFeed (GET /api/notifications → bell feed)', () => {
  it('maps the wire rows: kind = server type, parsed timestamp, wired CTA', () => {
    const feed = toFeed([notif()]);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      id: 'n1',
      kind: 'campaign_draft_reminder',
      title: 'Votre campagne démarre bientôt',
      action: { label: 'Consulter', path: '/my-campaigns?status=draft' },
    });
    expect(feed.items[0]?.timestamp.toISOString()).toBe('2026-07-10T08:00:00.000Z');
  });

  it('derives readIds from read_at — non-null ⇒ read, null ⇒ unread', () => {
    const feed = toFeed([
      notif({ id: 'unread', read_at: null }),
      notif({ id: 'read', read_at: '2026-07-11T09:00:00.000Z' }),
    ]);
    expect(feed.readIds).toEqual(['read']);
  });

  it('keeps an unknown-type row visible with a null action', () => {
    const feed = toFeed([notif({ type: 'some_future_type' })]);
    expect(feed.items[0]?.action).toBeNull();
    expect(feed.items[0]?.title).toBe('Votre campagne démarre bientôt');
  });
});

describe('polling parity with the owner bell', () => {
  it('polls at the owner bell cadence (60 s)', () => {
    expect(POLL_INTERVAL_MS).toBe(60_000);
  });
});
