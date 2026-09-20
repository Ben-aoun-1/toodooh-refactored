// CF-S1 — the ONE campaign status map (spec §3.1/3.2). Every surface (grid cards, list rows,
// drawer badge, filters, widgets) consumes THIS map: upcoming/completed are STORED statuses now
// (no date-derived pseudo-statuses), and the old grid/list label collision (draft rendered as
// « Non validé » in the grid, « Terminée » vs « Passée » for completed) is dead.

// ADM-FIX1 — the ids as an ORDERED runtime list, with the union DERIVED from it. The admin queue
// validates a `?status=` URL param against these, so a hand-written union that drifted from the
// stored enum (the admin types carried a 4-valued one) can no longer exist.
export const CAMPAIGN_STATUS_IDS = [
  'draft',
  'pending',
  'upcoming',
  'active',
  'rejected',
  'completed',
] as const;

export type CampaignStatusId = (typeof CAMPAIGN_STATUS_IDS)[number];

/** Narrowing guard for untrusted strings (URL params, wire payloads) — never a cast. */
export const isCampaignStatusId = (value: string | null | undefined): value is CampaignStatusId =>
  value !== null &&
  value !== undefined &&
  (CAMPAIGN_STATUS_IDS as readonly string[]).includes(value);

export interface CampaignStatusUi {
  label: string;
  /** Tailwind classes for the card/list badges. */
  bg: string;
  text: string;
  dot: string;
  /** Hex palette for the drawer badge (inline-styled there, faithful to its design). */
  drawer: { bg: string; border: string; dot: string; text: string };
}

export const CAMPAIGN_STATUS_UI: Record<CampaignStatusId, CampaignStatusUi> = {
  draft: {
    label: 'Brouillon',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    drawer: { bg: '#FFFAEB', border: '#FFECC0', dot: '#F6B51E', text: '#F6B51E' },
  },
  pending: {
    label: 'En attente',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    dot: 'bg-orange-500',
    drawer: { bg: '#FFF3EB', border: '#FFD4BC', dot: '#FA7319', text: '#FA7319' },
  },
  upcoming: {
    label: 'À venir',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    drawer: { bg: '#EFF6FF', border: '#BFDBFE', dot: '#3B82F6', text: '#2563EB' },
  },
  active: {
    label: 'Active',
    bg: 'bg-green-50',
    text: 'text-green-700',
    dot: 'bg-green-500',
    drawer: { bg: '#E3F7EC', border: '#76E6AB', dot: '#1FC16B', text: '#1FC16B' },
  },
  rejected: {
    label: 'Non validé',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    drawer: { bg: '#FFEBEC', border: '#FFC5C7', dot: '#FB3748', text: '#FB3748' },
  },
  completed: {
    label: 'Passée',
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    dot: 'bg-gray-500',
    drawer: { bg: '#F5F5F5', border: '#EBEBEB', dot: '#5C5C5C', text: '#5C5C5C' },
  },
};

/** Lookup with a draft fallback for unknown/legacy strings (e.g. the retired 'paused'). */
export const campaignStatusUi = (status: string): CampaignStatusUi =>
  CAMPAIGN_STATUS_UI[status as CampaignStatusId] ?? CAMPAIGN_STATUS_UI.draft;
