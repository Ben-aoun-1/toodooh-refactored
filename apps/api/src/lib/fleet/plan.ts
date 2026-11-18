import { type DispatchCreneau } from '../../db/schema.js';

import { isOpenAt } from './status.js';

// FLEET-1 — a venue's plan for ONE Tunis day, hour by hour, PURE: which campaigns should air and
// how many passes, from the airable allocations (tours: their créneaux of that day; the v1 engine:
// r_i on every opening hour, or every hour when the venue declared none).

export interface PlanRow {
  campaignId: string;
  campaignName: string;
  engine: string;
  rI: number;
  creneaux: readonly DispatchCreneau[];
}

export interface HourPlan {
  hour: number;
  reps: number;
  campaigns: { id: string; name: string; reps: number }[];
}

export const dayPlan = (
  rows: readonly PlanRow[],
  date: string,
  opening: number | null,
  closing: number | null,
): HourPlan[] => {
  const hours: HourPlan[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    reps: 0,
    campaigns: [],
  }));
  const add = (hour: number, row: PlanRow, reps: number) => {
    const h = hours[hour];
    if (!h || reps <= 0) return;
    h.reps += reps;
    const existing = h.campaigns.find((c) => c.id === row.campaignId);
    if (existing) existing.reps += reps;
    else h.campaigns.push({ id: row.campaignId, name: row.campaignName, reps });
  };
  const declared = opening !== null && closing !== null;
  for (const row of rows) {
    if (row.engine === 'tours') {
      for (const c of row.creneaux) if (c.date === date) add(c.hour, row, c.reps);
    } else {
      for (let hour = 0; hour < 24; hour += 1) {
        if (!declared || isOpenAt(hour, opening, closing)) add(hour, row, row.rI);
      }
    }
  }
  return hours;
};

/** The hour the current run of planned hours began (walking back from `hour`), or null. */
export const plannedRunStart = (plan: readonly HourPlan[], hour: number): number | null => {
  if ((plan[hour]?.reps ?? 0) <= 0) return null;
  let start = hour;
  while (start > 0 && (plan[start - 1]?.reps ?? 0) > 0) start -= 1;
  return start;
};
