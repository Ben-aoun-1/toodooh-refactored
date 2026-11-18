import { describe, expect, it } from 'vitest';

import type { FleetScreenWire } from '@/features/admin/services/admin-fleet.service';

import {
  countByStatus,
  filterFleet,
  hourTone,
  sinceLabel,
  statusSentence,
  todayRatio,
  zonesOf,
} from './fleet';

const now = new Date('2026-03-10T10:30:00Z');
const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

const screen = (over: Partial<FleetScreenWire> = {}): FleetScreenWire => ({
  id: 's1',
  name: 'Écran 1',
  venue: { id: 'v1', name: 'La Rosa', zone: 'Tunis centre' },
  status: 'diffuse',
  connected: true,
  last_seen_at: ago(0.2),
  paired_at: ago(10_000),
  open_now: true,
  match_now: false,
  now: { planned_reps: 6, campaigns: [{ id: 'c1', name: 'Toodooh Test', reps: 6 }] },
  last_proof: { at: ago(4), campaign_name: 'Toodooh Test' },
  today: { planned_total: 52, planned_so_far: 45, aired: 38 },
  device: null,
  device_report_at: null,
  issues: [],
  ...over,
});

describe('FLEET-1 — « Parc d’écrans » display', () => {
  it('relative times', () => {
    expect(sinceLabel(ago(0.2), now)).toBe('à l’instant');
    expect(sinceLabel(ago(4), now)).toBe('il y a 4 min');
    expect(sinceLabel(ago(185), now)).toBe('il y a 3 h');
    expect(sinceLabel(ago(3000), now)).toBe('il y a 2 j');
    expect(sinceLabel(null, now)).toBe('jamais');
  });

  it('one sentence per state', () => {
    expect(statusSentence(screen(), now)).toBe(
      'Diffuse Toodooh Test · dernier passage il y a 4 min',
    );
    expect(
      statusSentence(
        screen({ status: 'muet', last_proof: { at: ago(85), campaign_name: null } }),
        now,
      ),
    ).toBe('Devrait diffuser Toodooh Test · dernier passage il y a 1 h');
    expect(
      statusSentence(
        screen({ status: 'rien_prevu', match_now: true, now: { planned_reps: 0, campaigns: [] } }),
        now,
      ),
    ).toBe('Match en cours : les campagnes sont en pause');
    expect(
      statusSentence(screen({ status: 'hors_ligne_ouverture', last_seen_at: ago(42) }), now),
    ).toBe('Hors ligne depuis 42 min · 6 passages prévus cette heure');
    expect(statusSentence(screen({ status: 'jamais' }), now)).toBe('Pas encore installé');
  });

  it('counts, ratio, zones', () => {
    const list = [
      screen(),
      screen({ id: 's2', status: 'muet' }),
      screen({ id: 's3', status: 'muet', venue: { id: 'v2', name: 'B', zone: null } }),
    ];
    expect(countByStatus(list)).toMatchObject({ diffuse: 1, muet: 2, hors_ligne_ouverture: 0 });
    expect(todayRatio(screen())).toBeCloseTo(38 / 45);
    expect(todayRatio(screen({ today: { planned_total: 0, planned_so_far: 0, aired: 0 } }))).toBe(
      0,
    );
    expect(zonesOf(list)).toEqual(['Tunis centre']);
  });

  it('filters by state, zone and text; most urgent first', () => {
    const list = [
      screen({ id: 'a', status: 'diffuse', venue: { id: 'v1', name: 'Zeta', zone: 'Z1' } }),
      screen({
        id: 'b',
        status: 'hors_ligne_ouverture',
        venue: { id: 'v2', name: 'Alpha', zone: 'Z2' },
      }),
      screen({ id: 'c', status: 'muet', venue: { id: 'v3', name: 'Beta', zone: 'Z1' } }),
    ];
    const all = { status: 'all' as const, zone: 'all', search: '' };
    expect(filterFleet(list, all).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(filterFleet(list, { ...all, zone: 'Z1' }).map((s) => s.id)).toEqual(['c', 'a']);
    expect(filterFleet(list, { ...all, status: 'muet' }).map((s) => s.id)).toEqual(['c']);
    expect(filterFleet(list, { ...all, search: 'toodooh' })).toHaveLength(3);
    expect(filterFleet(list, { ...all, search: 'alph' }).map((s) => s.id)).toEqual(['b']);
  });

  it('the day strip: what each hour tells at a glance', () => {
    const h = (hour: number, planned: number, aired: number, blackout = 0) => ({
      hour,
      planned,
      aired,
      blackout_minutes: blackout,
    });
    expect(hourTone(h(9, 6, 6), 11)).toBe('ok');
    expect(hourTone(h(9, 6, 2), 11)).toBe('partial');
    expect(hourTone(h(9, 6, 0), 11)).toBe('missed');
    expect(hourTone(h(11, 6, 0), 11)).toBe('future');
    expect(hourTone(h(15, 3, 0), 11)).toBe('future');
    expect(hourTone(h(9, 0, 0), 11)).toBe('idle');
    expect(hourTone(h(20, 6, 0, 60), 11)).toBe('match');
  });
});
