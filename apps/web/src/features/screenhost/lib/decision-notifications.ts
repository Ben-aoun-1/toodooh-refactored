import { differenceInCalendarDays, parseISO } from 'date-fns';

import type { PendingAllocation } from '@/features/screenhost/services/screenhost-allocations.service';
import type { OwnerCampaign } from '@/features/screenhost/services/screenhost-campaigns.service';
import type { PendingEventAllocation } from '@/features/screenhost/services/screenhost-event-allocations.service';

/**
 * NOTIF-D1 — the owner's accept/refuse notifications and the « Consulter » popup.
 *
 * ONE producer type carries every decision the owner owes: `dispatch_pending_acceptance`, written
 * by the campaign dispatch, the event dispatch and the event boost, each with `campaign_id` set
 * (for an event it is the positioning's campaign row). The owner decides per ALLOCATION; the
 * notification is per CAMPAIGN, so « still to decide » means: at least one of the owner's
 * allocations on that campaign is still pending.
 */
export const DECISION_NOTIFICATION_TYPE = 'dispatch_pending_acceptance';

export interface BucketableNotification {
  id: string;
  kind: string;
  campaignId: string | null;
}

export const isDecisionNotification = (n: Pick<BucketableNotification, 'kind' | 'campaignId'>) =>
  n.kind === DECISION_NOTIFICATION_TYPE && n.campaignId !== null;

/** Campaign ids the owner still has to decide — classic allocations AND event proposals. */
export const pendingCampaignIds = (
  allocations: readonly Pick<PendingAllocation, 'campaign_id'>[],
  events: readonly Pick<PendingEventAllocation, 'campaign_id'>[],
): ReadonlySet<string> =>
  new Set([...allocations.map((a) => a.campaign_id), ...events.map((e) => e.campaign_id)]);

/**
 * Ruling 5A (operator, 2026-09-29): a decision notification leaves the main list ONLY once it is
 * decided — seeing it (read) is not enough. Every other notification moves to « Historique » once
 * read. `pendingKnown` is false while the pending lists load: until then a decision notification
 * stays active, so it never flickers into the history and back.
 */
export const notificationBucket = (
  n: BucketableNotification,
  read: boolean,
  pending: ReadonlySet<string>,
  pendingKnown: boolean,
): 'active' | 'history' => {
  if (isDecisionNotification(n)) {
    if (!pendingKnown) return 'active';
    return n.campaignId !== null && pending.has(n.campaignId) ? 'active' : 'history';
  }
  return read ? 'history' : 'active';
};

export const splitNotifications = <T extends BucketableNotification>(
  items: readonly T[],
  readIds: ReadonlySet<string>,
  pending: ReadonlySet<string>,
  pendingKnown: boolean,
): { active: T[]; history: T[] } => {
  const active: T[] = [];
  const history: T[] = [];
  for (const item of items) {
    const bucket = notificationBucket(item, readIds.has(item.id), pending, pendingKnown);
    (bucket === 'active' ? active : history).push(item);
  }
  return { active, history };
};

export type DecisionTarget =
  | { kind: 'event'; proposals: PendingEventAllocation[] }
  | { kind: 'campaign'; campaign: OwnerCampaign; pendingIds: string[] }
  | { kind: 'missing' };

/**
 * What the popup shows for a campaign id. Ruling 4A: an event proposal gets the same popup with
 * the event's fields. A fleet owner may hold several allocations of one campaign (one per venue):
 * the popup decides them TOGETHER — the notification is per campaign, so is the decision.
 */
export const decisionTarget = (
  campaignId: string,
  events: readonly PendingEventAllocation[],
  campaigns: readonly OwnerCampaign[],
): DecisionTarget => {
  const proposals = events.filter((e) => e.campaign_id === campaignId);
  if (proposals.length > 0) return { kind: 'event', proposals };
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) return { kind: 'missing' };
  const pendingIds = campaign.allocations
    .filter((a) => a.statut_acceptation === 'EN_ATTENTE')
    .map((a) => a.id);
  return { kind: 'campaign', campaign, pendingIds };
};

/** Inclusive day count, the wizard's rule (a 1-day campaign starts and ends the same day). */
export const campaignDurationDays = (start: string | null, end: string | null): number | null => {
  if (!start || !end) return null;
  const days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
  return Number.isFinite(days) && days > 0 ? days : null;
};

export type DecisionOutcome = 'accepted' | 'refused';

/** The two Figma outcome cards (frames 589 / 591); the event wording swaps the noun. */
export const outcomeCopy = (
  outcome: DecisionOutcome,
  target: 'campaign' | 'event',
): { title: string; lines: [string, string] } => {
  const noun = target === 'event' ? 'L’événement' : 'La campagne';
  const nounLower = target === 'event' ? 'Cet événement' : 'Cette campagne';
  if (outcome === 'accepted') {
    return {
      title: 'Félicitations !',
      lines: [
        `${noun} est désormais programmé${target === 'event' ? '' : 'e'} pour diffusion dans votre établissement.`,
        'Veillez à maintenir vos écrans actifs durant toute la période afin de garantir une diffusion optimale et un revenu maximal.',
      ],
    };
  }
  return {
    title: 'Refus enregistré',
    lines: [
      `${nounLower} ne sera pas diffusé${target === 'event' ? '' : 'e'} dans votre établissement.`,
      'D’autres opportunités vous seront proposées prochainement.',
    ],
  };
};

export const refuseQuestion = (target: 'campaign' | 'event'): string =>
  target === 'event'
    ? 'Êtes-vous sûr de vouloir refuser cet événement ?'
    : 'Êtes-vous sûr de vouloir refuser cette campagne ?';
