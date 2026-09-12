import type {
  OwnerCampaign,
  OwnerDecision,
} from '@/features/screenhost/services/screenhost-campaigns.service';

/**
 * CAMP-E1 — pure helpers behind the owner « Mes campagnes » page (no render harness, so the
 * status/decision mapping, the tab predicates and the copy are pinned here).
 */

export type OwnerCampaignStatusFilter =
  | 'all'
  | 'to_decide'
  | 'active'
  | 'upcoming'
  | 'pending'
  | 'completed';

export const STATUS_FILTERS: readonly { key: OwnerCampaignStatusFilter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'to_decide', label: 'À valider' },
  { key: 'active', label: 'Actives' },
  { key: 'upcoming', label: 'À venir' },
  { key: 'pending', label: 'En attente' },
  { key: 'completed', label: 'Terminées' },
];

/** The calm empty state (Mejri 2026-09-11: zero campaigns must NOT read as an error). */
export const EMPTY_STATE_TITLE = 'Aucune campagne pour le moment';
export const EMPTY_STATE_DETAIL =
  'Les campagnes apparaîtront ici dès que la diffusion en placera une sur vos établissements.';

/** A real fetch failure keeps a toast — distinct from the empty state. */
export const LOAD_ERROR_MESSAGE = 'Impossible de charger les campagnes';

/** The decision CTA — accept/reject lives on /owner-allocations (never duplicated here). */
export const DECIDE_CTA_LABEL = 'Décider';
export const DECIDE_ROUTE = '/owner-allocations';

/** « À valider » = the owner still has at least one allocation awaiting their decision. */
export const needsDecision = (decision: OwnerDecision): boolean =>
  decision === 'EN_ATTENTE' || decision === 'MIXTE';

export const matchesStatusFilter = (
  campaign: Pick<OwnerCampaign, 'status' | 'owner_decision'>,
  filter: OwnerCampaignStatusFilter,
): boolean => {
  if (filter === 'all') return true;
  if (filter === 'to_decide') return needsDecision(campaign.owner_decision);
  return campaign.status === filter;
};

/** Name OR advertiser, case-insensitive; an empty query matches everything. */
export const matchesSearch = (
  campaign: Pick<OwnerCampaign, 'name' | 'advertiser_name'>,
  query: string,
): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    campaign.name.toLowerCase().includes(q) || campaign.advertiser_name.toLowerCase().includes(q)
  );
};

export const countByFilter = (
  campaigns: readonly Pick<OwnerCampaign, 'status' | 'owner_decision'>[],
): Record<OwnerCampaignStatusFilter, number> => ({
  all: campaigns.length,
  to_decide: campaigns.filter((c) => matchesStatusFilter(c, 'to_decide')).length,
  active: campaigns.filter((c) => matchesStatusFilter(c, 'active')).length,
  upcoming: campaigns.filter((c) => matchesStatusFilter(c, 'upcoming')).length,
  pending: campaigns.filter((c) => matchesStatusFilter(c, 'pending')).length,
  completed: campaigns.filter((c) => matchesStatusFilter(c, 'completed')).length,
});

export interface StatusUi {
  label: string;
  badge: string;
  dot: string;
}

/** campaigns.status → the badge (the pre-rewrite palette, minus the date-derived « À venir »). */
export const statusUi = (status: string): StatusUi => {
  switch (status) {
    case 'active':
      return {
        label: 'Active',
        badge: 'bg-green-50 text-green-700 border border-green-200',
        dot: 'bg-green-500',
      };
    case 'upcoming':
      return {
        label: 'À venir',
        badge: 'bg-blue-50 text-blue-700 border border-blue-200',
        dot: 'bg-blue-500',
      };
    case 'completed':
      return {
        label: 'Terminée',
        badge: 'bg-gray-100 text-gray-700 border border-gray-200',
        dot: 'bg-gray-500',
      };
    case 'rejected':
      return {
        label: 'Refusée',
        badge: 'bg-red-50 text-red-700 border border-red-200',
        dot: 'bg-red-500',
      };
    case 'draft':
      return {
        label: 'Brouillon',
        badge: 'bg-amber-50 text-amber-700 border border-amber-200',
        dot: 'bg-amber-500',
      };
    default:
      return {
        label: 'En attente',
        badge: 'bg-orange-50 text-orange-700 border border-orange-200',
        dot: 'bg-orange-500',
      };
  }
};

/** The owner's decision chip (their side of the story, next to the campaign status). */
export const decisionUi = (decision: OwnerDecision): { label: string; className: string } => {
  switch (decision) {
    case 'ACCEPTE':
      return { label: 'Acceptée', className: 'bg-[#E8F8EE] text-[#1FC16B]' };
    case 'REFUSE':
      return { label: 'Refusée par vous', className: 'bg-gray-100 text-[#5C5C5C]' };
    case 'MIXTE':
      return { label: 'Décision partielle', className: 'bg-[#FFF4DB] text-[#B47A00]' };
    default:
      return { label: 'À valider', className: 'bg-[#FFF4DB] text-[#B47A00]' };
  }
};

/** Per-venue allocation statut, as shown in the details drawer. */
export const allocationStatutLabel = (statut: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE'): string => {
  if (statut === 'ACCEPTE') return 'Acceptée';
  if (statut === 'REFUSE') return 'Refusée';
  return 'En attente';
};

export const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

export const fmtDateRange = (start: string | null, end: string | null): string =>
  !start || !end ? '—' : `${fmtDate(start)} -> ${fmtDate(end)}`;

/** « 1 établissement » / « 3 établissements ». */
export const venuesLabel = (count: number): string =>
  `${count} établissement${count > 1 ? 's' : ''}`;
