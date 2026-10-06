import { asc, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { type EventRow, type TeamRow, campaigns, eventMatches, teams } from '../db/schema.js';
import { storage } from '../storage/s3-storage.js';

import { tunisDateOf } from './campaign-dates.js';
import { fenetreDiffusion, statutEvenement } from './fenetre-diffusion.js';

// EVT-CAT2 (operator rulings 2026-10-06) — ONE home for the new « Événements » catalogue rules:
// the team/match wire, « can this match be positioned now » (B1 included) and the positioning
// draft both the single and the multi-match parcours create.

export interface TeamWire {
  id: string;
  name: string;
  is_national: boolean;
  color_main: string;
  color_second: string;
  color_crowd: string | null;
  /** Presigned logo/flag; null = none uploaded (logos are optional). */
  logo_url: string | null;
}

export interface MatchWire {
  position: number;
  home: TeamWire;
  /** null = « Adversaire après tirage ». */
  away: TeamWire | null;
}

const presignLogo = async (key: string | null): Promise<string | null> => {
  if (key === null) return null;
  const signed = await storage.getPresignedUrl({ key });
  return 'error' in signed ? null : signed.url;
};

export const teamWire = async (team: TeamRow): Promise<TeamWire> => ({
  id: team.id,
  name: team.name,
  is_national: team.isNational,
  color_main: team.colorMain,
  color_second: team.colorSecond,
  color_crowd: team.colorCrowd,
  logo_url: await presignLogo(team.logoKey),
});

/** The matches of each event, in display order, teams resolved (each logo presigned once). */
export const matchesByEvent = async (
  eventIds: readonly string[],
): Promise<Map<string, MatchWire[]>> => {
  const out = new Map<string, MatchWire[]>();
  if (eventIds.length === 0) return out;
  const rows = await db
    .select()
    .from(eventMatches)
    .where(inArray(eventMatches.eventId, [...eventIds]))
    .orderBy(asc(eventMatches.eventId), asc(eventMatches.position));
  const teamIds = [
    ...new Set(rows.flatMap((r) => (r.awayTeamId ? [r.homeTeamId, r.awayTeamId] : [r.homeTeamId]))),
  ];
  const teamRows =
    teamIds.length === 0 ? [] : await db.select().from(teams).where(inArray(teams.id, teamIds));
  const wires = new Map<string, TeamWire>();
  for (const t of teamRows) wires.set(t.id, await teamWire(t));
  for (const r of rows) {
    const home = wires.get(r.homeTeamId);
    if (!home) continue;
    const list = out.get(r.eventId) ?? [];
    list.push({
      position: r.position,
      home,
      away: r.awayTeamId ? (wires.get(r.awayTeamId) ?? null) : null,
    });
    out.set(r.eventId, list);
  }
  return out;
};

export type PositionRefusal = { error: string; message: string };

/**
 * Why this match cannot be positioned now, or null when it can. B1 — a date or kickoff time
 * still « à confirmer » blocks it: pricing and the blocs would rest on a provisional instant.
 */
export const positioningRefusal = (row: EventRow, now: Date): PositionRefusal | null => {
  if (row.annule) return { error: 'EVENT_ANNULE', message: 'Cet événement est annulé.' };
  if (statutEvenement(now, row.kickoffAt, row.endsAt) === 'termine') {
    return {
      error: 'EVENT_TERMINE',
      message: 'Cet événement est terminé — le positionnement n’est plus possible.',
    };
  }
  if (row.dateTbc || row.timeTbc) {
    return {
      error: 'EVENT_NOT_CONFIRMED',
      message:
        'La date ou l’horaire de ce match n’est pas encore confirmé — le positionnement ouvrira à la confirmation.',
    };
  }
  return null;
};

/**
 * The positioning DRAFT (EV3): a campaign row bound to the match, named after it, its dates the
 * diffusion window's Tunis dates snapshotted here — from then on it rides the classic draft
 * machinery (PATCH steps, zones, creative link, cart, lifecycle).
 */
export const createPositioningDraft = async (
  executor: Pick<typeof db, 'insert'>,
  advertiserId: string,
  row: EventRow,
) => {
  const fenetre = fenetreDiffusion(row.kickoffAt, row.endsAt);
  const [created] = await executor
    .insert(campaigns)
    .values({
      advertiserId,
      name: row.name,
      campaignType: 'event',
      status: 'draft',
      startDate: tunisDateOf(fenetre.windowStart),
      endDate: tunisDateOf(fenetre.windowEnd),
      eventId: row.id,
    })
    .returning();
  return created ?? null;
};
