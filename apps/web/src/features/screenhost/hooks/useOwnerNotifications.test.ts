import { describe, expect, it } from 'vitest';

import type { ApiNotification } from '@/services/notifications.service';

import { actionFor } from './useOwnerNotifications';

const notif = (type: string): ApiNotification => ({
  id: 'n1',
  type,
  title: 'Titre',
  body: '',
  campaign_id: null,
  read_at: null,
  created_at: '2026-07-01T08:00:00.000Z',
});

describe('actionFor (bell CTA routing by type)', () => {
  it('routes monthly_report_ready to Mes performances (Mejri prod-test #1)', () => {
    expect(actionFor(notif('monthly_report_ready'))).toEqual({
      actionLabel: 'Consulter',
      actionPath: '/owner-performance',
    });
  });

  it('keeps dispatch_pending_acceptance on the allocations surface', () => {
    expect(actionFor(notif('dispatch_pending_acceptance')).actionPath).toBe('/owner-allocations');
  });

  it('REV2 — both facture types land on « Mes factures » (they had NO action path before)', () => {
    expect(actionFor(notif('screenhost_facture_ready'))).toEqual({
      actionLabel: 'Consulter',
      actionPath: '/owner-factures',
    });
    expect(actionFor(notif('screenhost_facture_deposited'))).toEqual({
      actionLabel: 'Consulter',
      actionPath: '/owner-factures',
    });
  });

  it('REV2 — the LEGACY FCT2 type is kept and routed to the same list', () => {
    // Rows in this shape exist in production and migration 0062 does not rewrite them. Dropping
    // this arm would strand every one of them on the campaigns fallback.
    expect(actionFor(notif('reversement_statement_ready')).actionPath).toBe('/owner-factures');
  });

  it('keeps every other type on the campaigns fallback', () => {
    for (const type of ['campaign_activated', 'campaign_rejected', 'some_future_type']) {
      expect(actionFor(notif(type)).actionPath).toBe('/owner-campaigns');
    }
  });
});
