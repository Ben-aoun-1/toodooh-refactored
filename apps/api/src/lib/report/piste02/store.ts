import { endOfMonth, format, parseISO, subMonths } from 'date-fns';
import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  businessSectors,
  governorates,
  type ScreenhostPiste,
  screenhostPistes,
  screenhostUnavailability,
  screenhosts,
  zones,
} from '../../../db/schema.js';
import { type ReportData, assembleReportData } from '../assemble.js';

import { generatePiste02 } from './generate.js';
import { type PisteHistory, type VenueFacts, planPiste02 } from './input.js';
import { isFamilleLevier } from './referentiel.js';

/**
 * PISTES-V2 — the stored Piste 02 (screenhost_pistes, mig 0083). Generated ONCE per completed
 * month (operator 2026-10-12, Q10 A): the month-end job and the regeneration script call
 * ensureMonthPiste02 before rendering the month's PDF; the page and the on-demand PDF read
 * latestPiste02, so every surface shows the same text and the model never runs on a page load.
 */

/** Spec §2 — the lever-family rotation window, in months. */
export const ROTATION_MONTHS = 3;

const monthRange = (month: string): { from: string; to: string } => {
  const first = parseISO(`${month}-01`);
  return { from: format(first, 'yyyy-MM-dd'), to: format(endOfMonth(first), 'yyyy-MM-dd') };
};

const shiftMonth = (month: string, back: number): string =>
  format(subMonths(parseISO(`${month}-01`), back), 'yyyy-MM');

async function loadVenueFacts(venueId: string, month: string): Promise<VenueFacts | null> {
  const [venue] = await db
    .select({
      venueName: screenhosts.name,
      sectorName: businessSectors.name,
      venueClass: screenhosts.class,
      zoneName: zones.name,
      city: screenhosts.city,
      governorateName: governorates.name,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .leftJoin(zones, eq(screenhosts.zoneId, zones.id))
    .leftJoin(governorates, eq(screenhosts.governorateId, governorates.id))
    .where(eq(screenhosts.id, venueId))
    .limit(1);
  if (!venue) return null;
  const { from, to } = monthRange(month);
  const closures = await db
    .select({ day: screenhostUnavailability.day })
    .from(screenhostUnavailability)
    .where(
      and(
        eq(screenhostUnavailability.screenhostId, venueId),
        gte(screenhostUnavailability.day, from),
        lte(screenhostUnavailability.day, to),
      ),
    );
  return { ...venue, closures: closures.map((c) => c.day) };
}

async function loadHistory(
  venueId: string,
  month: string,
): Promise<{ history: PisteHistory; firstReport: boolean }> {
  const rows = await db
    .select()
    .from(screenhostPistes)
    .where(and(eq(screenhostPistes.screenhostId, venueId), lt(screenhostPistes.month, month)))
    .orderBy(desc(screenhostPistes.month));
  const windowStart = shiftMonth(month, ROTATION_MONTHS);
  const recent = rows.filter((r) => r.month >= windowStart);
  return {
    firstReport: rows.length === 0,
    history: {
      familles: [...new Set(recent.map((r) => r.familleLevier).filter(isFamilleLevier))],
      titres: rows.map((r) => r.titre).filter((t): t is string => t !== null && t !== ''),
      creneaux: [...new Set(recent.flatMap((r) => r.creneauxCites))],
    },
  };
}

/** The previous month's audience total, or null when that month has no measured day. */
async function previousMonthGlobal(venueId: string, month: string): Promise<number | null> {
  const previous = await assembleReportData(venueId, monthRange(shiftMonth(month, 1)));
  return previous && previous.kpis.measuredDays > 0 ? previous.kpis.global : null;
}

/**
 * The month's stored Piste 02, generating and storing it when absent. null = nothing to show (no
 * référentiel category for the sector, no API key, or the API failed — the next run retries).
 * `data` is the month's ReportData the caller already assembled for the PDF.
 */
export async function ensureMonthPiste02(
  venueId: string,
  month: string,
  data: ReportData,
): Promise<ScreenhostPiste | null> {
  const [existing] = await db
    .select()
    .from(screenhostPistes)
    .where(and(eq(screenhostPistes.screenhostId, venueId), eq(screenhostPistes.month, month)))
    .limit(1);
  if (existing) return existing;

  const facts = await loadVenueFacts(venueId, month);
  if (!facts) return null;
  const { history, firstReport } = await loadHistory(venueId, month);
  const plan = planPiste02({
    month,
    data,
    facts,
    history,
    firstReport,
    previousGlobal: data.kpis.measuredDays > 0 ? await previousMonthGlobal(venueId, month) : null,
  });
  if (plan.kind === 'skip') return null;
  const result = await generatePiste02(plan);
  if (!result) return null;

  // UNIQUE(screenhost, month): a concurrent run loses here and reads the winner's row.
  const [inserted] = await db
    .insert(screenhostPistes)
    .values({ screenhostId: venueId, month, ...result })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [winner] = await db
    .select()
    .from(screenhostPistes)
    .where(and(eq(screenhostPistes.screenhostId, venueId), eq(screenhostPistes.month, month)))
    .limit(1);
  return winner ?? null;
}

/** The venue's most recent stored Piste 02 (the last complete month that has one). */
export async function latestPiste02(venueId: string): Promise<ScreenhostPiste | null> {
  const [row] = await db
    .select()
    .from(screenhostPistes)
    .where(eq(screenhostPistes.screenhostId, venueId))
    .orderBy(desc(screenhostPistes.month))
    .limit(1);
  return row ?? null;
}
