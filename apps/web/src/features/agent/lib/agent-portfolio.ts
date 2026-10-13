import type { AgentCampaign, AgentCampaignStatus } from '../services/agent-portfolio.service';

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
export const campaignCounters = (rows: AgentCampaign[]) => ({
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
