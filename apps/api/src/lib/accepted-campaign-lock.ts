import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  eventAllocations,
  events,
} from '../db/schema.js';

import { notDemoCampaignSql } from './demo.js';

// Mariem 13/11/2026 (« Changements à livrer avant le test », point 3) — a Screenhost that has
// ACCEPTED a campaign can no longer declare itself unavailable on the days of that campaign. ONE
// home for the rule: the owner's PUT refuses the declaration, the calendar read lists the locked
// days. Undeclaring stays free, and the admin « Fiche Host » mirror is not gated (the operator
// can still move a share by hand).
//
// « Accepted » = an ACCEPTE allocation of a live campaign (pending / upcoming / active) at the
// venue: a classic campaign locks every day of [start_date, end_date]; a match positioning locks
// its kick-off day (Tunis). Demo campaigns never lock (the owner never saw nor decided them).

const LIVE = ['pending', 'upcoming', 'active'] as const;

const addIsoDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Opening day → the accepted campaigns' names that lock it, over [from, to]. */
export const acceptedCampaignDays = async (
  venueId: string,
  from: string,
  to: string,
): Promise<Map<string, string[]>> => {
  const classic = await db
    .selectDistinct({
      name: campaigns.name,
      start: campaigns.startDate,
      end: campaigns.endDate,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .where(
      and(
        eq(campaignDispatchAllocation.screenhostId, venueId),
        eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
        inArray(campaigns.status, [...LIVE]),
        lte(campaigns.startDate, to),
        gte(campaigns.endDate, from),
        notDemoCampaignSql(),
      ),
    );
  const kickoffDay = sql<string>`to_char(${events.kickoffAt} AT TIME ZONE 'Africa/Tunis', 'YYYY-MM-DD')`;
  const matches = await db
    .selectDistinct({ name: campaigns.name, day: kickoffDay })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(
      and(
        eq(eventAllocations.screenhostId, venueId),
        eq(eventAllocations.statut, 'ACCEPTE'),
        inArray(campaigns.status, [...LIVE]),
        eq(events.annule, false),
        gte(kickoffDay, from),
        lte(kickoffDay, to),
        notDemoCampaignSql(),
      ),
    );

  const days = new Map<string, string[]>();
  const add = (day: string, name: string) => {
    const names = days.get(day) ?? [];
    if (!names.includes(name)) names.push(name);
    days.set(day, names);
  };
  for (const c of classic) {
    if (c.start === null || c.end === null) continue;
    const first = c.start > from ? c.start : from;
    const last = c.end < to ? c.end : to;
    for (let d = first; d <= last; d = addIsoDays(d, 1)) add(d, c.name);
  }
  for (const m of matches) add(m.day, m.name);
  return days;
};

/** The owner-facing refusal (French, ONE home). */
export const acceptedCampaignLockMessage = (names: readonly string[]): string =>
  names.length === 1
    ? `Vous avez accepté la campagne « ${names[0]} » sur cette période : vous ne pouvez plus vous déclarer indisponible ce jour-là.`
    : `Vous avez accepté les campagnes ${names.map((n) => `« ${n} »`).join(', ')} sur cette période : vous ne pouvez plus vous déclarer indisponible ce jour-là.`;
