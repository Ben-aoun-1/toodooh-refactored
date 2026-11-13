import { describe, expect, it } from 'vitest';

import type { OwnerCampaign } from '@/features/screenhost/services/screenhost-campaigns.service';
import type { PendingEventAllocation } from '@/features/screenhost/services/screenhost-event-allocations.service';

import {
  DECISION_NOTIFICATION_TYPE,
  campaignDurationDays,
  decisionTarget,
  notificationBucket,
  outcomeCopy,
  pendingDecisionKeys,
  refuseQuestion,
  splitNotifications,
} from './decision-notifications';
import { MATCH_NOTIFICATION_TYPE, matchKey } from './match-decision';

const decision = (id: string, campaignId: string) => ({
  id,
  kind: DECISION_NOTIFICATION_TYPE,
  campaignId,
});
const info = (id: string) => ({ id, kind: 'monthly_report_ready', campaignId: null });

describe('notificationBucket — ruling 5A', () => {
  const pending = new Set(['camp-pending']);

  it('keeps a READ decision notification active while its campaign is still to decide', () => {
    expect(notificationBucket(decision('n1', 'camp-pending'), true, pending, true)).toBe('active');
  });

  it('moves a decision notification to history once decided, read or not', () => {
    expect(notificationBucket(decision('n1', 'camp-done'), false, pending, true)).toBe('history');
    expect(notificationBucket(decision('n1', 'camp-done'), true, pending, true)).toBe('history');
  });

  it('never files a decision notification while the pending lists are still loading', () => {
    expect(notificationBucket(decision('n1', 'camp-done'), true, new Set(), false)).toBe('active');
  });

  it('moves every other notification to history once read', () => {
    expect(notificationBucket(info('n2'), false, pending, true)).toBe('active');
    expect(notificationBucket(info('n2'), true, pending, true)).toBe('history');
  });

  it('treats a decision-type row without campaign_id as an ordinary notification', () => {
    const orphan = { id: 'n3', kind: DECISION_NOTIFICATION_TYPE, campaignId: null };
    expect(notificationBucket(orphan, true, pending, true)).toBe('history');
  });

  it('keeps a « Soir de match » notice active while its match is still to answer (Mariem 05/11)', () => {
    const notice = {
      id: 'n4',
      kind: MATCH_NOTIFICATION_TYPE,
      campaignId: null,
      eventId: 'ev1',
      screenhostId: 'sh1',
    };
    expect(notificationBucket(notice, true, new Set([matchKey('ev1', 'sh1')]), true)).toBe(
      'active',
    );
    expect(notificationBucket(notice, false, new Set([matchKey('ev1', 'sh2')]), true)).toBe(
      'history',
    );
    expect(notificationBucket(notice, true, new Set(), false)).toBe('active');
  });
});

describe('splitNotifications', () => {
  it('partitions preserving order', () => {
    const items = [decision('a', 'c1'), info('b'), decision('c', 'c2'), info('d')];
    const { active, history } = splitNotifications(items, new Set(['b']), new Set(['c1']), true);
    expect(active.map((n) => n.id)).toEqual(['a', 'd']);
    expect(history.map((n) => n.id)).toEqual(['b', 'c']);
  });
});

describe('pendingDecisionKeys', () => {
  it('unions classic allocations, event shares proposed alone and matches to answer', () => {
    const keys = pendingDecisionKeys(
      [{ campaign_id: 'c1' }],
      [
        { campaign_id: 'e1', grouped: false },
        { campaign_id: 'e2', grouped: true },
      ],
      [{ event_id: 'ev1', screenhost_id: 'sh1' }],
    );
    // A grouped share keeps no campaign notification open: its match popup answers it.
    expect([...keys].sort()).toEqual(['c1', 'e1', matchKey('ev1', 'sh1')].sort());
  });
});

const campaign = (statuts: OwnerCampaign['allocations'][number]['statut_acceptation'][]) =>
  ({
    id: 'c1',
    allocations: statuts.map((statut_acceptation, i) => ({
      id: `a${i}`,
      statut_acceptation,
    })),
  }) as OwnerCampaign;

describe('decisionTarget', () => {
  it('prefers the event proposals for an event positioning', () => {
    const events = [{ id: 'ev1', campaign_id: 'c1', grouped: false }] as PendingEventAllocation[];
    expect(decisionTarget('c1', events, [campaign(['EN_ATTENTE'])]).kind).toBe('event');
  });

  it('never decides a grouped share, nor an event positioning through the campaign endpoints', () => {
    const grouped = [{ id: 'ev1', campaign_id: 'c1', grouped: true }] as PendingEventAllocation[];
    const eventCampaign = {
      ...campaign(['EN_ATTENTE']),
      event: { kickoff_at: '2027-09-15T19:00:00Z', ends_at: '2027-09-15T21:00:00Z' },
    } as OwnerCampaign;
    expect(decisionTarget('c1', grouped, [eventCampaign]).kind).toBe('missing');
  });

  it('decides every pending allocation of the campaign together (fleet owner)', () => {
    const target = decisionTarget('c1', [], [campaign(['EN_ATTENTE', 'ACCEPTE', 'EN_ATTENTE'])]);
    expect(target).toMatchObject({ kind: 'campaign', pendingIds: ['a0', 'a2'] });
  });

  it('opens a decided campaign read-only (no pending ids)', () => {
    expect(decisionTarget('c1', [], [campaign(['ACCEPTE'])])).toMatchObject({ pendingIds: [] });
  });

  it('reports a missing campaign', () => {
    expect(decisionTarget('zz', [], [campaign(['ACCEPTE'])]).kind).toBe('missing');
  });
});

describe('campaignDurationDays', () => {
  it('counts inclusively', () => {
    expect(campaignDurationDays('2025-12-28', '2026-01-03')).toBe(7);
    expect(campaignDurationDays('2026-01-03', '2026-01-03')).toBe(1);
  });
  it('is null without both dates', () => {
    expect(campaignDurationDays(null, '2026-01-03')).toBeNull();
  });
});

describe('outcomeCopy — Figma frames 589 / 591', () => {
  it('matches the campaign wording', () => {
    expect(outcomeCopy('accepted', 'campaign').title).toBe('Félicitations !');
    expect(outcomeCopy('refused', 'campaign').lines[0]).toBe(
      'Cette campagne ne sera pas diffusée dans votre établissement.',
    );
  });
  it('swaps the noun for an event', () => {
    expect(outcomeCopy('refused', 'event').lines[0]).toBe(
      'Cet événement ne sera pas diffusé dans votre établissement.',
    );
  });
  it('speaks of the match for a « Soir de match » answer', () => {
    expect(outcomeCopy('accepted', 'match').lines[0]).toBe(
      'Le match est désormais programmé pour diffusion dans votre établissement.',
    );
    expect(outcomeCopy('refused', 'match').lines[0]).toBe(
      'Ce match ne sera pas diffusé dans votre établissement.',
    );
    expect(outcomeCopy('accepted', 'campaign').lines[0]).toBe(
      'La campagne est désormais programmée pour diffusion dans votre établissement.',
    );
  });
});

describe('refuseQuestion', () => {
  it('asks about the subject being refused', () => {
    expect(refuseQuestion('campaign')).toBe('Êtes-vous sûr de vouloir refuser cette campagne ?');
    expect(refuseQuestion('event')).toBe('Êtes-vous sûr de vouloir refuser cet événement ?');
    expect(refuseQuestion('match')).toBe('Êtes-vous sûr de vouloir refuser ce match ?');
  });
});
