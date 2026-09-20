import {
  isCampaignStatusId,
  type CampaignStatusId,
} from '@/features/campaigns/lib/campaign-status';

// ADM-FIX1 — the admin campaign-review queue's pure rules (apps/web has no render harness, so the
// page keeps NO logic of its own):
//   • the status filter, which is driven by the URL (`/admin-campaigns?status=…`) so the dashboard
//     tiles can deep-link into a bucket — the page used to hold it in a plain useState and ignore
//     the query string entirely;
//   • the « Période dépassée » predicate (CONTROLLER RULING, display-only).

/** 'all' is a UI-only value: the api returns every campaign when `?status=` is omitted. */
export const CAMPAIGN_QUEUE_ALL = 'all';

export type CampaignQueueFilter = CampaignStatusId | typeof CAMPAIGN_QUEUE_ALL;

/** The bucket the queue opens on when the URL carries no (or an unknown) `status`. */
export const CAMPAIGN_QUEUE_DEFAULT: CampaignQueueFilter = 'pending';

/**
 * The <select> options, in operator order. The labels are the QUEUE's plural vocabulary
 * (« Actives », « Terminées »), not the canonical badge labels — the badge keeps those.
 */
export const CAMPAIGN_QUEUE_OPTIONS: readonly { value: CampaignQueueFilter; label: string }[] = [
  { value: 'pending', label: 'En attente' },
  { value: 'upcoming', label: 'À venir' },
  { value: 'active', label: 'Actives' },
  { value: 'completed', label: 'Terminées' },
  { value: 'rejected', label: 'Rejetées' },
  { value: 'draft', label: 'Brouillons' },
  { value: CAMPAIGN_QUEUE_ALL, label: 'Toutes' },
];

/** Narrowing guard — the only way an untrusted string becomes a filter. */
export const isCampaignQueueFilter = (
  value: string | null | undefined,
): value is CampaignQueueFilter => value === CAMPAIGN_QUEUE_ALL || isCampaignStatusId(value);

/** A `?status=` param (or a <select> value) → a filter; anything unknown falls back to the default. */
export const parseCampaignQueueFilter = (value: string | null | undefined): CampaignQueueFilter =>
  isCampaignQueueFilter(value) ? value : CAMPAIGN_QUEUE_DEFAULT;

/** What the queue sends to the api: `undefined` for « Toutes » (the param is omitted). */
export const queueFilterStatus = (filter: CampaignQueueFilter): CampaignStatusId | undefined =>
  filter === CAMPAIGN_QUEUE_ALL ? undefined : filter;

// ── « Période dépassée » (CONTROLLER RULING, display-only and reversible) ──────────────────────
// A campaign still waiting for moderation whose end_date is STRICTLY before the Tunis day can no
// longer be delivered, so the queue says so and disables « Approuver (activer) ». Nothing is
// written: no lifecycle pass, no status change — the row stays 'pending' until a human acts.

export const PERIODE_DEPASSEE_LABEL = 'Période dépassée';
export const PERIODE_DEPASSEE_REASON =
  'La période de diffusion est déjà terminée — cette campagne ne peut plus être activée.';

const DAY = /^\d{4}-\d{2}-\d{2}/;

export interface PeriodeDepasseeInput {
  status: string;
  /** The campaign's end_date ('YYYY-MM-DD'), nullable while a draft. */
  endDate: string | null;
  /** The Tunis calendar day, passed in: no pure rule ever reads the wall clock. */
  todayIso: string;
}

export const isPeriodeDepassee = ({ status, endDate, todayIso }: PeriodeDepasseeInput): boolean => {
  if (status !== 'pending' || endDate === null) return false;
  const end = DAY.exec(endDate)?.[0];
  if (end === undefined || DAY.exec(todayIso)?.[0] !== todayIso) return false;
  return end < todayIso;
};
