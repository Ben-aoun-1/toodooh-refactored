import type { AcceptedAllocation } from '@/features/screenhost/services/screenhost-calendar.service';

// CAL-1 — the diffusion layer of the merged owner calendar: accepted allocations regrouped by
// calendar date (extracted from the retired OwnerCampaignCalendar so it is unit-testable). One entry
// per (allocation, date) with that date's hours and summed impressions.

export interface DayAiring {
  allocationId: string;
  campaignId: string;
  campaignName: string;
  screenhostId: string;
  screenhostName: string;
  startDate: string | null;
  endDate: string | null;
  hours: number[];
  impressions: number;
}

export const groupCreneauxByDate = (
  allocations: readonly AcceptedAllocation[],
): Map<string, DayAiring[]> => {
  const map = new Map<string, DayAiring[]>();
  for (const a of allocations) {
    const perDate = new Map<string, { hours: number[]; impressions: number }>();
    for (const c of a.creneaux) {
      const entry = perDate.get(c.date) ?? { hours: [], impressions: 0 };
      entry.hours.push(c.hour);
      entry.impressions += c.impressions;
      perDate.set(c.date, entry);
    }
    for (const [date, entry] of perDate) {
      const list = map.get(date) ?? [];
      list.push({
        allocationId: a.id,
        campaignId: a.campaign_id,
        campaignName: a.campaign_name,
        screenhostId: a.screenhost_id,
        screenhostName: a.screenhost_name,
        startDate: a.start_date,
        endDate: a.end_date,
        hours: [...entry.hours].sort((x, y) => x - y),
        impressions: entry.impressions,
      });
      map.set(date, list);
    }
  }
  return map;
};

/** Distinct campaigns airing on a day (the confirm dialog counts campaigns, not slots). */
export const campaignsOnDay = (airings: readonly DayAiring[] | undefined): string[] => [
  ...new Set((airings ?? []).map((a) => a.campaignName)),
];

/** The confirm question before declaring a day that carries accepted diffusion. */
export const declareConfirmCopy = (campaignNames: readonly string[]): string => {
  const n = campaignNames.length;
  const list = campaignNames.map((name) => `« ${name} »`).join(', ');
  return n === 1
    ? `La campagne ${list} diffuse ce jour-là. Sa part sur ce jour sera redistribuée à d'autres établissements. Confirmer l'indisponibilité ?`
    : `${n} campagnes diffusent ce jour-là (${list}). Leur part sur ce jour sera redistribuée à d'autres établissements. Confirmer l'indisponibilité ?`;
};

export interface RedispatchedShare {
  campaign_id: string;
  campaign_name: string;
  mode: 'cascade' | 'reliquat';
  slots_moved: number;
  v_fact: number;
  absorbed: number;
  residual: number;
}

/** The success toast after a declaration, from the api's own account of what moved. */
export const declareResultCopy = (redispatched: readonly RedispatchedShare[]): string => {
  if (redispatched.length === 0) return 'Jour déclaré indisponible.';
  const parts = redispatched.map((r) =>
    r.mode === 'reliquat'
      ? `« ${r.campaign_name} » : la part de ce jour sera redistribuée au prochain passage`
      : r.residual > 0
        ? `« ${r.campaign_name} » : part redistribuée en partie (reste à replacer)`
        : `« ${r.campaign_name} » : part redistribuée à d'autres établissements`,
  );
  return `Jour déclaré indisponible — ${parts.join(' ; ')}.`;
};

export const fmtLongDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};
