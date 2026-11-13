import { differenceInCalendarDays, parseISO } from 'date-fns';

import { matchKey, matchOfNotification } from '@/features/screenhost/lib/match-decision';
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
  /** Mariem 05/11 — a « Soir de match » notice names its match and venue instead. */
  eventId?: string | null;
  screenhostId?: string | null;
}

/** What a decision notification waits on: its campaign, or its match at a venue. */
const decisionKey = (
  n: Pick<BucketableNotification, 'kind' | 'campaignId' | 'eventId' | 'screenhostId'>,
): string | null => {
  const match = matchOfNotification(n);
  if (match) return matchKey(match.eventId, match.screenhostId);
  return n.kind === DECISION_NOTIFICATION_TYPE ? n.campaignId : null;
};

export const isDecisionNotification = (
  n: Pick<BucketableNotification, 'kind' | 'campaignId' | 'eventId' | 'screenhostId'>,
) => decisionKey(n) !== null;

/**
 * What the owner still has to decide: campaign ids (classic allocations and event shares proposed
 * alone) and match keys (« Soir de match », Mariem 05/11). A share answered in its match popup
 * (`grouped`) keeps no campaign notification open.
 */
export const pendingDecisionKeys = (
  allocations: readonly Pick<PendingAllocation, 'campaign_id'>[],
  events: readonly Pick<PendingEventAllocation, 'campaign_id' | 'grouped'>[],
  matches: readonly { event_id: string; screenhost_id: string }[] = [],
): ReadonlySet<string> =>
  new Set([
    ...allocations.map((a) => a.campaign_id),
    ...events.filter((e) => !e.grouped).map((e) => e.campaign_id),
    ...matches.map((m) => matchKey(m.event_id, m.screenhost_id)),
  ]);

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
  const key = decisionKey(n);
  if (key !== null) {
    if (!pendingKnown) return 'active';
    return pending.has(key) ? 'active' : 'history';
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
  // Mariem 05/11 — a grouped share is answered in its match popup, never here.
  const proposals = events.filter((e) => e.campaign_id === campaignId && !e.grouped);
  if (proposals.length > 0) return { kind: 'event', proposals };
  const campaign = campaigns.find((c) => c.id === campaignId);
  // An event positioning is never decided through the campaign endpoints.
  if (!campaign || campaign.event) return { kind: 'missing' };
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

/** What the owner decides on: a campaign, an event share, or a whole match (Mariem 05/11). */
export type DecisionSubject = 'campaign' | 'event' | 'match';

const SUBJECT_NOUNS: Record<DecisionSubject, { the: string; this: string; feminine: boolean }> = {
  campaign: { the: 'La campagne', this: 'Cette campagne', feminine: true },
  event: { the: 'L’événement', this: 'Cet événement', feminine: false },
  match: { the: 'Le match', this: 'Ce match', feminine: false },
};

/** The two Figma outcome cards (frames 589 / 591); the event and match wordings swap the noun. */
export const outcomeCopy = (
  outcome: DecisionOutcome,
  target: DecisionSubject,
): { title: string; lines: [string, string] } => {
  const noun = SUBJECT_NOUNS[target];
  const e = noun.feminine ? 'e' : '';
  if (outcome === 'accepted') {
    return {
      title: 'Félicitations !',
      lines: [
        `${noun.the} est désormais programmé${e} pour diffusion dans votre établissement.`,
        'Veillez à maintenir vos écrans actifs durant toute la période afin de garantir une diffusion optimale et un revenu maximal.',
      ],
    };
  }
  return {
    title: 'Refus enregistré',
    lines: [
      `${noun.this} ne sera pas diffusé${e} dans votre établissement.`,
      'D’autres opportunités vous seront proposées prochainement.',
    ],
  };
};

export const refuseQuestion = (target: DecisionSubject): string =>
  `Êtes-vous sûr de vouloir refuser ${SUBJECT_NOUNS[target].this.toLowerCase()} ?`;

/**
 * Operator 2026-10-12 — the decision popup shows what the owner earns by accepting: the sum of
 * their share (revenu_previsionnel, already the owner's 50 % TTC from the api) over the venues
 * still AWAITING a decision; once nothing is pending, the campaign's total. Millime-exact.
 */
export const campaignDecisionRevenueTnd = (campaign: {
  allocations: readonly { statut_acceptation: string; revenu_previsionnel: number }[];
  totals: { revenu_previsionnel: number };
}): number => {
  const pending = campaign.allocations.filter((a) => a.statut_acceptation === 'EN_ATTENTE');
  if (pending.length === 0) return campaign.totals.revenu_previsionnel;
  return Math.round(pending.reduce((sum, a) => sum + a.revenu_previsionnel * 1000, 0)) / 1000;
};

/** The same for an event: Σ the pending proposals' montant (the owner's share, from the api). */
export const eventDecisionRevenueTnd = (proposals: readonly { montant_tnd: number }[]): number =>
  Math.round(proposals.reduce((sum, p) => sum + p.montant_tnd * 1000, 0)) / 1000;

/** The popup's label for the campaign type chip (operator 2026-10-12: « Particuliers »). */
export const DECISION_TYPE_LABEL = 'Particuliers';
