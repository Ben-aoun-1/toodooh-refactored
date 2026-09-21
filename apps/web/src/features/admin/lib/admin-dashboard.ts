import { format, isValid, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

import {
  CAMPAIGN_QUEUE_OPTIONS,
  type CampaignQueueFilter,
} from '@/features/admin/lib/campaign-queue';
import type { PlatformStats } from '@/features/admin/types/platform-stats';
import type { CampaignStatusId } from '@/features/campaigns/lib/campaign-status';

// DASH-1 — the admin dashboard's pure view rules (apps/web has no render harness, so the page
// keeps no logic of its own). Operator rulings, 2026-09-21:
//   • R6 — campaign status labels come from the ONE vocabulary (the admin queue's options, which
//     share their stem with the canonical badge map), and « Activité campagnes » lists all six
//     stored statuses in lifecycle order;
//   • the campaign tiles deep-link into the queue, « Total » included (it used to land on the
//     queue's default « En attente »);
//   • every money figure says HT.

/** R6 — lifecycle order: Brouillons · En attente · À venir · Actives · Passées · Non validés. */
export const CAMPAIGN_ACTIVITY_ORDER: readonly CampaignStatusId[] = [
  'draft',
  'pending',
  'upcoming',
  'active',
  'completed',
  'rejected',
];

/** The admin queue's own label for a filter — never a local synonym. */
export const campaignFilterLabel = (filter: CampaignQueueFilter): string =>
  CAMPAIGN_QUEUE_OPTIONS.find((o) => o.value === filter)?.label ?? filter;

/** The queue URL for a filter; `?status=all` opens « Toutes ». */
export const campaignQueueHref = (filter: CampaignQueueFilter): string =>
  `/admin-campaigns?status=${filter}`;

/** Tailwind colour of each status count (the page's palette, pending in the tiles' yellow). */
const ACTIVITY_VALUE_CLASS: Record<CampaignStatusId, string> = {
  draft: 'text-gray-900',
  pending: 'text-yellow-600',
  upcoming: 'text-blue-600',
  active: 'text-green-600',
  completed: 'text-gray-900',
  rejected: 'text-gray-900',
};

export interface CampaignActivityRow {
  status: CampaignStatusId;
  label: string;
  count: number;
  valueClass: string;
}

/** « Activité campagnes » — six rows in lifecycle order; zeros while the stats load. */
export const campaignActivityRows = (
  campaigns: PlatformStats['campaigns'] | undefined,
): CampaignActivityRow[] =>
  CAMPAIGN_ACTIVITY_ORDER.map((status) => ({
    status,
    label: campaignFilterLabel(status),
    count: campaigns?.[status] ?? 0,
    valueClass: ACTIVITY_VALUE_CLASS[status],
  }));

const TND = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'TND',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** « 1 234,50 TND HT » — every money figure the dashboard reads is HT, so each one says so. */
export const formatHt = (amount: number): string => `${TND.format(amount)} HT`;

/** The wire's Tunis month ('YYYY-MM') → « octobre 2026 »; « — » when absent or malformed. */
export function revenueMonthLabel(month: string | undefined): string {
  if (month === undefined || !/^\d{4}-\d{2}$/.test(month)) return '—';
  const d = parseISO(`${month}-01`);
  return isValid(d) ? format(d, 'MMMM yyyy', { locale: fr }) : '—';
}
