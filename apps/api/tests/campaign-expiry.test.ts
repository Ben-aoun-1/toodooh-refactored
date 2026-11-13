import { describe, expect, it } from 'vitest';

import { expiryDeadline, expiryNotice, expiryStep } from '../src/lib/campaign-expiry.js';

// DISP-TOURS §3.1/3.2 — the never-launched classic campaign's clock, on Mariem's own examples.
const at = (local: string): Date => new Date(`${local}+01:00`); // a Tunis wall-clock instant

describe('campaign expiry — Mariem’s examples', () => {
  it('a cart campaign starting 15/11: notices on 13/11 and 14/11, deleted on 15/11', () => {
    const saved = at('2026-11-03T10:00:00');
    const clock = { startDate: '2026-11-15', lastSavedAt: saved, noticeSentAt: null };
    expect(expiryDeadline(clock)).toEqual(at('2026-11-15T00:00:00'));
    expect(expiryStep(clock, at('2026-11-12T23:30:00'))).toEqual({ kind: 'none' });
    expect(expiryStep(clock, at('2026-11-13T00:10:00'))).toEqual({ kind: 'notice', hours: 48 });
    const told48 = { ...clock, noticeSentAt: at('2026-11-13T00:10:00') };
    expect(expiryStep(told48, at('2026-11-13T05:00:00'))).toEqual({ kind: 'none' });
    expect(expiryStep(told48, at('2026-11-14T00:10:00'))).toEqual({ kind: 'notice', hours: 24 });
    const told24 = { ...clock, noticeSentAt: at('2026-11-14T00:10:00') };
    expect(expiryStep(told24, at('2026-11-14T12:00:00'))).toEqual({ kind: 'none' });
    expect(expiryStep(told24, at('2026-11-15T00:05:00'))).toEqual({ kind: 'delete' });
  });

  it('an undated draft saved 3/11 at 10 h: notices 8/11 and 9/11 at 10 h, deleted 10/11 at 10 h', () => {
    const clock = { startDate: null, lastSavedAt: at('2026-11-03T10:00:00'), noticeSentAt: null };
    expect(expiryDeadline(clock)).toEqual(at('2026-11-10T10:00:00'));
    expect(expiryStep(clock, at('2026-11-08T09:59:00'))).toEqual({ kind: 'none' });
    expect(expiryStep(clock, at('2026-11-08T10:20:00'))).toEqual({ kind: 'notice', hours: 48 });
    const told48 = { ...clock, noticeSentAt: at('2026-11-08T10:20:00') };
    expect(expiryStep(told48, at('2026-11-09T10:20:00'))).toEqual({ kind: 'notice', hours: 24 });
    const told24 = { ...clock, noticeSentAt: at('2026-11-09T10:20:00') };
    expect(expiryStep(told24, at('2026-11-10T09:59:00'))).toEqual({ kind: 'none' });
    expect(expiryStep(told24, at('2026-11-10T10:00:00'))).toEqual({ kind: 'delete' });
  });
});

describe('campaign expiry — the edges', () => {
  it('a campaign made to start today keeps its whole day', () => {
    const clock = {
      startDate: '2026-11-15',
      lastSavedAt: at('2026-11-15T09:00:00'),
      noticeSentAt: null,
    };
    expect(expiryDeadline(clock)).toEqual(at('2026-11-16T00:00:00'));
    expect(expiryStep(clock, at('2026-11-15T10:00:00'))).toEqual({ kind: 'none' });
    expect(expiryStep(clock, at('2026-11-16T00:00:00'))).toEqual({ kind: 'delete' });
  });

  it('a save inside a window skips that notice, never the next one', () => {
    const clock = {
      startDate: '2026-11-15',
      lastSavedAt: at('2026-11-13T12:00:00'),
      noticeSentAt: null,
    };
    expect(expiryStep(clock, at('2026-11-13T13:00:00'))).toEqual({ kind: 'none' });
    expect(expiryStep(clock, at('2026-11-14T00:30:00'))).toEqual({ kind: 'notice', hours: 24 });
  });

  it('missed ticks send only the closer notice', () => {
    const clock = {
      startDate: '2026-11-15',
      lastSavedAt: at('2026-11-03T10:00:00'),
      noticeSentAt: null,
    };
    const step = expiryStep(clock, at('2026-11-14T03:00:00'));
    expect(step).toEqual({ kind: 'notice', hours: 24 });
    const told = { ...clock, noticeSentAt: at('2026-11-14T03:00:00') };
    expect(expiryStep(told, at('2026-11-14T04:00:00'))).toEqual({ kind: 'none' });
  });

  it('a later start date re-arms both notices', () => {
    const clock = {
      startDate: '2026-11-30',
      lastSavedAt: at('2026-11-13T10:00:00'),
      noticeSentAt: at('2026-11-13T00:10:00'),
    };
    expect(expiryStep(clock, at('2026-11-28T00:10:00'))).toEqual({ kind: 'notice', hours: 48 });
  });
});

describe('campaign expiry — the notices, in Mariem’s words', () => {
  it('the cart notice', () => {
    expect(expiryNotice('Danette', true, 48)).toEqual({
      type: 'campaign_cart_expiry',
      text: 'Votre campagne « Danette » sera retirée de votre panier dans 48 h. Lancez-la avant cette échéance pour la conserver.',
    });
    expect(expiryNotice('Danette', true, 24).text).toContain('dans 24 h.');
  });

  it('the draft notice', () => {
    expect(expiryNotice('Danette', false, 24)).toEqual({
      type: 'campaign_draft_expiry',
      text: 'Votre brouillon « Danette » sera supprimé dans 24 h. Reprenez sa saisie pour le conserver.',
    });
  });
});
