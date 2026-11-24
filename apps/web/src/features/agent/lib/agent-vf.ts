import type {
  AgentCampaign,
  AgentCampaignStatus,
  ShAgentCampaign,
} from '../services/agent-portfolio.service';

// AGENT-VF — the display rules the prototype's script carried (catKey, shSub, stBadge, campCard),
// pure, for the two agent types.

export type VfCategoryKey = 'cafe' | 'resto' | 'sport' | 'loisir' | 'shop';

/** The pictogram of a venue's category; an unknown or missing category reads as a shop. */
export function vfCategoryKey(category: string | null | undefined): VfCategoryKey {
  if (!category) return 'shop';
  const c = category.toLowerCase();
  if (c.includes('caf')) return 'cafe';
  if (c.includes('resto') || c.includes('restau')) return 'resto';
  if (c.includes('sport')) return 'sport';
  if (c.includes('loisir')) return 'loisir';
  return 'shop';
}

type AffiliateStatus = 'en_attente_activation' | 'en_cours' | 'terminee';

/** The small line under a Screenhost's name: the owner, else the category, else the status. */
export function vfVenueSubline(v: {
  owner_name?: string | null;
  category: string | null;
  status: AffiliateStatus;
}): string {
  if (v.owner_name) return v.owner_name;
  if (v.category) return v.category;
  return v.status === 'en_attente_activation' ? 'En attente d’activation' : 'Screenhost affilié';
}

export const VF_STATUS_BADGE: Record<AgentCampaignStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'b-act' },
  a_venir: { label: 'À venir', cls: 'b-av' },
  terminee: { label: 'Terminée', cls: 'b-ter' },
};

export const VF_TYPE_FR: Record<AgentCampaign['type'], string> = {
  standard: 'Standard',
  parc: 'Parc',
  evenement: 'Événement',
};

/** « 11/11/2026 », an unknown date « – ». */
export const vfDate = (iso: string | null | undefined): string => {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '–';
};

export const isShAgentCampaign = (c: AgentCampaign | ShAgentCampaign): c is ShAgentCampaign =>
  'venues' in c;

export interface VfCampCard {
  id: string;
  name: string;
  /** The advertiser (Screenhost agent) or the affiliated Screencaster. */
  party: string;
  status: AgentCampaignStatus;
  /** « Du 11/11/2026 au 15/11/2026 · 1 Screenhost touché » (the suffix only for a Screenhost agent). */
  dates: string;
  /** « À gagner » while the campaign lives, « Revenu » once it is over. */
  moneyLabel: 'À gagner' | 'Revenu';
  moneyTnd: number;
  impressions: number;
}

export function vfCampCard(c: AgentCampaign | ShAgentCampaign): VfCampCard {
  const over = c.status === 'terminee';
  const range = `Du ${vfDate(c.start_date)} au ${vfDate(c.end_date)}`;
  const sh = isShAgentCampaign(c);
  return {
    id: c.id,
    name: c.name,
    party: sh ? c.advertiser_name : c.affiliate_name,
    status: c.status,
    dates: sh
      ? `${range} · ${c.venues_touched} Screenhost${c.venues_touched > 1 ? 's' : ''} touché${c.venues_touched > 1 ? 's' : ''}`
      : range,
    moneyLabel: over ? 'Revenu' : 'À gagner',
    moneyTnd: over ? c.revenue_tnd : c.to_earn_tnd,
    impressions: c.impressions,
  };
}

/**
 * « Participation » (spec VF « Mes Screenhosts ») — the share of days the Screenhost declared
 * available over the follow-up window (30 days): a day with only some hours blocked still counts
 * as available. Unknown while the venue has no follow-up yet.
 */
export const vfParticipation = (
  unavailableDays: number | null | undefined,
  windowDays = 30,
): number | null => {
  if (unavailableDays === null || unavailableDays === undefined) return null;
  const free = Math.max(0, windowDays - unavailableDays);
  return Math.round((free / windowDays) * 100);
};

/** « 2 points d'attention ». */
export const vfAttentionLabel = (n: number): string => `${n} point${n > 1 ? 's' : ''} d’attention`;

/** The points of a sparkline over [0, 100], in a w × h box (prototype `spark`). */
export const vfSparkPoints = (values: (number | null)[], w = 400, h = 70): string => {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return '';
  return known
    .map((v, i) => `${((i / (known.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`)
    .join(' ');
};
