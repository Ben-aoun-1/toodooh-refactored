import type {
  AgentCampaign,
  AgentCampaignStatus,
  FollowupRow,
  ShAgentCampaign,
} from '../services/agent-portfolio.service';

// AGT-4 (Agent Screencaster spec v1.0 §4–§6) — the portfolio pages' rules, pure.

export const CAMPAIGN_STATUS_FR: Record<AgentCampaignStatus, string> = {
  a_venir: 'À venir',
  active: 'Active',
  terminee: 'Terminée',
};

/** Blue / green / grey badges (§5 « Statuts »). */
export const CAMPAIGN_STATUS_CLASS: Record<AgentCampaignStatus, string> = {
  a_venir: 'bg-blue-50 text-blue-700',
  active: 'bg-emerald-50 text-emerald-700',
  terminee: 'bg-gray-100 text-gray-600',
};

export const CAMPAIGN_TYPE_FR: Record<AgentCampaign['type'], string> = {
  standard: 'Standard',
  parc: 'Parc',
  evenement: 'Événement',
};

export type CampaignTab = 'all' | AgentCampaignStatus;

/** The counters banner: Total = Actives + À venir + Terminées by construction. */
export const campaignCounters = (rows: { status: AgentCampaignStatus }[]) => ({
  total: rows.length,
  active: rows.filter((r) => r.status === 'active').length,
  a_venir: rows.filter((r) => r.status === 'a_venir').length,
  terminee: rows.filter((r) => r.status === 'terminee').length,
});

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tab + search (campaign or Screencaster name, accent-insensitive) + optional affiliate. */
export const filterCampaigns = (
  rows: AgentCampaign[],
  tab: CampaignTab,
  search: string,
  affiliateId: string | null,
): AgentCampaign[] => {
  const q = fold(search.trim());
  return rows.filter(
    (r) =>
      (tab === 'all' || r.status === tab) &&
      (affiliateId === null || r.affiliate_id === affiliateId) &&
      (q === '' || fold(r.name).includes(q) || fold(r.affiliate_name).includes(q)),
  );
};

/** jj/mm/aaaa, or a dash. */
export const frDate = (iso: string | null): string =>
  iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';

/** Initials for the standard avatar when the Screencaster has no logo. */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]] : [name.trim()];
  return letters
    .map((w) => (w ?? '').charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
};

/** « +12,5 % » / « −3 % », or null when the line is hidden. */
export const variationLabel = (pct: number | null): { text: string; up: boolean } | null => {
  if (pct === null) return null;
  const abs = Math.abs(pct).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return { text: `${pct >= 0 ? '+' : '−'}${abs} %`, up: pct >= 0 };
};

/** « Affiliation terminée » once the end date is reached (§6 « Fin d'affiliation »). */
export const affiliationEnded = (a: { status: string }) => a.status === 'terminee';

/** AGT-7 — one campaign card for both agent types (the avatar is the Screencaster / advertiser). */
export interface CampaignCardModel {
  id: string;
  name: string;
  status: AgentCampaignStatus;
  start_date: string | null;
  end_date: string | null;
  revenue_tnd: number;
  impressions: number;
  avatar_name: string;
  /** The Screencaster's name, or « N Screenhost(s) touché(s) ». */
  subtitle: string;
}

export const isShCampaign = (c: AgentCampaign | ShAgentCampaign): c is ShAgentCampaign =>
  'venues_touched' in c;

export const cardModel = (c: AgentCampaign | ShAgentCampaign): CampaignCardModel => ({
  id: c.id,
  name: c.name,
  status: c.status,
  start_date: c.start_date,
  end_date: c.end_date,
  revenue_tnd: c.revenue_tnd,
  impressions: c.impressions,
  avatar_name: isShCampaign(c) ? c.advertiser_name : c.affiliate_name,
  subtitle: isShCampaign(c)
    ? `${c.advertiser_name} — ${c.venues_touched} Screenhost${c.venues_touched > 1 ? 's' : ''} touché${c.venues_touched > 1 ? 's' : ''}`
    : c.affiliate_name,
});

/** The Screenhost agent's search: campaign, advertiser or venue name; optional venue filter. */
export const filterShCampaigns = (
  rows: ShAgentCampaign[],
  tab: CampaignTab,
  search: string,
  venueId: string | null,
): ShAgentCampaign[] => {
  const q = fold(search.trim());
  return rows.filter(
    (r) =>
      (tab === 'all' || r.status === tab) &&
      (venueId === null || r.venues.some((v) => v.id === venueId)) &&
      (q === '' ||
        fold(r.name).includes(q) ||
        fold(r.advertiser_name).includes(q) ||
        r.venues.some((v) => fold(v.name).includes(q))),
  );
};

export type FollowupSort = 'default' | 'name' | 'sps' | 'refused' | 'missed' | 'attention';

/** Attention points first, then increasing score (spec §6); or by a clicked column. */
export const sortFollowup = (rows: FollowupRow[], by: FollowupSort): FollowupRow[] => {
  const score = (r: FollowupRow) => r.sps ?? Number.POSITIVE_INFINITY;
  const copy = [...rows];
  switch (by) {
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    case 'sps':
      return copy.sort((a, b) => score(a) - score(b));
    case 'refused':
      return copy.sort((a, b) => b.refused - a.refused);
    case 'missed':
      return copy.sort((a, b) => b.missed - a.missed);
    case 'attention':
    case 'default':
      return copy.sort((a, b) => b.attention.length - a.attention.length || score(a) - score(b));
  }
};

/** « 72 / 100 », or a dash while the venue has no offer yet. */
export const scoreLabel = (sps: number | null): string =>
  sps === null ? '—' : `${Math.round(sps)} / 100`;

export const rateLabel = (v: number | null): string => (v === null ? '—' : `${Math.round(v)} %`);
