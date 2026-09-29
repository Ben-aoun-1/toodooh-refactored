import { describe, expect, it } from 'vitest';

import type { OwnerCampaign } from '@/features/screenhost/services/screenhost-campaigns.service';
import type { PendingEventAllocation } from '@/features/screenhost/services/screenhost-event-allocations.service';

import {
  DECISION_NOTIFICATION_TYPE,
  campaignDurationDays,
  decisionTarget,
  notificationBucket,
  outcomeCopy,
  pendingCampaignIds,
  splitNotifications,
} from './decision-notifications';

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
});

describe('splitNotifications', () => {
  it('partitions preserving order', () => {
    const items = [decision('a', 'c1'), info('b'), decision('c', 'c2'), info('d')];
    const { active, history } = splitNotifications(items, new Set(['b']), new Set(['c1']), true);
    expect(active.map((n) => n.id)).toEqual(['a', 'd']);
    expect(history.map((n) => n.id)).toEqual(['b', 'c']);
  });
});

describe('pendingCampaignIds', () => {
  it('unions classic allocations and event proposals', () => {
    const ids = pendingCampaignIds([{ campaign_id: 'c1' }], [{ campaign_id: 'e1' }]);
    expect([...ids].sort()).toEqual(['c1', 'e1']);
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
    const events = [{ id: 'ev1', campaign_id: 'c1' }] as PendingEventAllocation[];
    expect(decisionTarget('c1', events, [campaign(['EN_ATTENTE'])]).kind).toBe('event');
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
});
