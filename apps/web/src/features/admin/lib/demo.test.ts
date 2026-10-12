import { describe, expect, it } from 'vitest';

import type { DemoCampaign } from '../services/admin-demo.service';

import { demoAccountBody, onAirStatus, parseAmountTnd, parseDelayMinutes } from './demo';

const campaign = (over: Partial<DemoCampaign> = {}): DemoCampaign => ({
  id: 'c1',
  name: 'Démo',
  status: 'active',
  start_date: '2026-10-12',
  end_date: '2026-10-15',
  airs_at: null,
  on_air_pushed_at: null,
  ...over,
});

describe('DEMO-1 — admin « Démo » page rules', () => {
  it('the delay is a whole number of minutes in [0, 1440]', () => {
    expect(parseDelayMinutes('0')).toEqual({ ok: true, value: 0 });
    expect(parseDelayMinutes(' 15 ')).toEqual({ ok: true, value: 15 });
    expect(parseDelayMinutes('1440')).toEqual({ ok: true, value: 1440 });
    expect(parseDelayMinutes('1441').ok).toBe(false);
    expect(parseDelayMinutes('2.5').ok).toBe(false);
    expect(parseDelayMinutes('-1').ok).toBe(false);
    expect(parseDelayMinutes('').ok).toBe(false);
  });

  it('amounts take a French comma, at most 2 decimals, positive', () => {
    expect(parseAmountTnd('1 500,5')).toEqual({ ok: true, value: 1500.5 });
    expect(parseAmountTnd('2000')).toEqual({ ok: true, value: 2000 });
    expect(parseAmountTnd('0').ok).toBe(false);
    expect(parseAmountTnd('1.234').ok).toBe(false);
    expect(parseAmountTnd('abc').ok).toBe(false);
  });

  it('the account form maps to the api body (contact name optional)', () => {
    const form = {
      email: ' prospect@example.com ',
      password: 'demo-password',
      businessName: ' Prospect SARL ',
      contactName: '',
      balance: '2000',
    };
    expect(demoAccountBody(form)).toEqual({
      ok: true,
      value: {
        email: 'prospect@example.com',
        password: 'demo-password',
        business_name: 'Prospect SARL',
        balance_tnd: 2000,
      },
    });
    expect(demoAccountBody({ ...form, password: 'short' }).ok).toBe(false);
    expect(demoAccountBody({ ...form, email: 'nope' }).ok).toBe(false);
    expect(demoAccountBody({ ...form, businessName: ' ' }).ok).toBe(false);
  });

  it('the on-air line counts down to airs_at, then shows the push time', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const waiting = onAirStatus(campaign({ airs_at: '2026-10-12T10:04:10Z' }), now);
    expect(waiting.tone).toBe('waiting');
    expect(waiting.label).toBe('À l’antenne dans 5 min (11:04)');
    expect(onAirStatus(campaign({ airs_at: '2026-10-12T10:00:30Z' }), now).label).toBe(
      'À l’antenne dans moins d’une minute',
    );
    expect(onAirStatus(campaign({ airs_at: '2026-10-12T09:59:00Z' }), now).label).toBe(
      'Envoi aux écrans…',
    );
    expect(
      onAirStatus(
        campaign({ airs_at: '2026-10-12T09:59:00Z', on_air_pushed_at: '2026-10-12T09:59:10Z' }),
        now,
      ),
    ).toEqual({ label: 'À l’antenne depuis 10:59', tone: 'live' });
    expect(onAirStatus(campaign({ status: 'rejected' }), now).tone).toBe('stopped');
    expect(onAirStatus(campaign({ status: 'pending' }), now).label).toBe(
      'En attente de validation',
    );
  });
});
