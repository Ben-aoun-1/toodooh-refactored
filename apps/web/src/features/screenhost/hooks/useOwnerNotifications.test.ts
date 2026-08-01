import { describe, expect, it } from 'vitest';

import type { ApiNotification } from '@/services/notifications.service';

import { actionFor, detailFor } from './useOwnerNotifications';

const notif = (type: string, body = ''): ApiNotification => ({
  id: 'n1',
  type,
  title: 'Titre',
  body,
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

  it('REV3 — the three admin-driven transitions land on « Mes Revenus »', () => {
    // Validation, refusal and payment are about MONEY: the versement line appears on Mes Revenus,
    // and a refusal is acted on through the deposit slot that lives there too.
    for (const type of [
      'screenhost_facture_validated',
      'screenhost_facture_refused',
      'screenhost_facture_paid',
    ]) {
      expect(actionFor(notif(type)).actionPath).toBe('/owner-revenue');
    }
  });

  it('REV3 — the REV2 mappings are untouched by the three new ones', () => {
    for (const type of [
      'screenhost_facture_ready',
      'screenhost_facture_deposited',
      'reversement_statement_ready',
    ]) {
      expect(actionFor(notif(type)).actionPath).toBe('/owner-factures');
    }
  });

  it('keeps every other type on the campaigns fallback', () => {
    for (const type of ['campaign_activated', 'campaign_rejected', 'some_future_type']) {
      expect(actionFor(notif(type)).actionPath).toBe('/owner-campaigns');
    }
  });
});

describe('detailFor (REV3 — the refusal motif reaches the bell)', () => {
  it('a refused facture surfaces its body, which is where the motif lives', () => {
    // « Facture refusée » alone is a dead end: the owner cannot fix what they cannot see.
    const body = 'Votre facture de juillet 2026 a été refusée. Motif : Cachet manquant.';
    expect(detailFor(notif('screenhost_facture_refused', body))).toBe(body);
  });

  it('every OTHER type carries no detail — the bell is not restyled wholesale', () => {
    for (const type of [
      'screenhost_facture_validated',
      'screenhost_facture_paid',
      'screenhost_facture_ready',
      'monthly_report_ready',
      'dispatch_pending_acceptance',
    ]) {
      expect(detailFor(notif(type, 'un corps quelconque'))).toBeUndefined();
    }
  });

  it('an empty body yields no detail rather than an empty line', () => {
    expect(detailFor(notif('screenhost_facture_refused', ''))).toBeUndefined();
  });
});
