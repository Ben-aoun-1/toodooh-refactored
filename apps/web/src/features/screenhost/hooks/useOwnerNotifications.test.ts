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

  it('FCT2 — routes reversement_statement_ready to the relevés page', () => {
    expect(actionFor(notif('reversement_statement_ready')).actionPath).toBe('/owner-statements');
  });

  it('keeps every other type on the campaigns fallback', () => {
    for (const type of ['campaign_activated', 'campaign_rejected', 'some_future_type']) {
      expect(actionFor(notif(type)).actionPath).toBe('/owner-campaigns');
    }
  });
});
