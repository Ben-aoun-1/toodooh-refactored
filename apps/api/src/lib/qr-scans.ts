import { createHmac } from 'node:crypto';

import { formatInTimeZone } from 'date-fns-tz';
import { and, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { campaigns, ctaScans } from '../db/schema.js';

import { PLAYOUT_TZ } from './reconcile/delivered-slots.js';

// QR-SCAN1 (operator 16/11, rulings A A A) — the scans of a spot's QR code, as « Mes performances »
// and the rapport de clôture show them: per campaign (one QR per campaign, so never per venue),
// the total, the « personnes uniques », a rate per 1 000 impressions, and the Tunis day and hour
// of each scan. ONE home: the route and the PDF read the summary from here.
//
// Privacy: a scan stores no IP and no browser string, only an opaque key that changes every
// Tunis day (HMAC with the server secret), so a person counts once per day and no one can be
// followed from one day to the next or traced back to an address.

const VISITOR_KEY_CHARS = 32;

/** The opaque per-day visitor key of a scan (no IP or browser kept). */
export const visitorHash = (
  secret: string,
  scannedAt: Date,
  ip: string,
  userAgent: string,
): string =>
  createHmac('sha256', secret)
    .update(
      `cta-visitor|${formatInTimeZone(scannedAt, PLAYOUT_TZ, 'yyyy-MM-dd')}|${ip}|${userAgent}`,
    )
    .digest('hex')
    .slice(0, VISITOR_KEY_CHARS);

export interface ScanRow {
  scannedAt: Date;
  /** null on scans recorded before migration 0114: each counts as one person. */
  visitorHash: string | null;
}

export interface QrScanSummary {
  scans: number;
  /** Distinct visitors per Tunis day, summed over the days. */
  uniqueVisitors: number;
  /** Scans per 1 000 impressions générées; null when there is no impression. */
  per1000Impressions: number | null;
  /** One row per Tunis day with at least one scan, oldest first. */
  byDay: { date: string; scans: number }[];
  /** 24 rows, hour 0 to 23 (Tunis). */
  byHour: { hour: number; scans: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** PURE — the summary of a set of scans against the impressions they came with. */
export const summarizeScans = (rows: readonly ScanRow[], impressions: number): QrScanSummary => {
  const byDay = new Map<string, number>();
  const byHour = new Array<number>(24).fill(0);
  const visitors = new Set<string>();
  let anonymous = 0;
  for (const r of rows) {
    const date = formatInTimeZone(r.scannedAt, PLAYOUT_TZ, 'yyyy-MM-dd');
    const hour = Number(formatInTimeZone(r.scannedAt, PLAYOUT_TZ, 'H'));
    byDay.set(date, (byDay.get(date) ?? 0) + 1);
    byHour[hour] = (byHour[hour] ?? 0) + 1;
    if (r.visitorHash === null) anonymous += 1;
    else visitors.add(`${date}|${r.visitorHash}`);
  }
  return {
    scans: rows.length,
    uniqueVisitors: visitors.size + anonymous,
    per1000Impressions: impressions > 0 ? round2((rows.length * 1000) / impressions) : null,
    byDay: [...byDay]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, scans]) => ({ date, scans })),
    byHour: byHour.map((scans, hour) => ({ hour, scans })),
  };
};

/** The campaigns among `campaignIds` that carry a QR code (a link). */
export const loadQrCampaignIds = async (campaignIds: readonly string[]): Promise<Set<string>> => {
  if (campaignIds.length === 0) return new Set();
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(inArray(campaigns.id, [...campaignIds]), isNotNull(campaigns.ctaUrl)));
  return new Set(rows.map((r) => r.id));
};

/** Every scan of these campaigns, by campaign id. */
export const loadScanRows = async (
  campaignIds: readonly string[],
): Promise<Map<string, ScanRow[]>> => {
  const out = new Map<string, ScanRow[]>();
  if (campaignIds.length === 0) return out;
  const rows = await db
    .select({
      campaignId: ctaScans.campaignId,
      scannedAt: ctaScans.scannedAt,
      visitorHash: ctaScans.visitorHash,
    })
    .from(ctaScans)
    .where(inArray(ctaScans.campaignId, [...campaignIds]));
  for (const r of rows) {
    const list = out.get(r.campaignId) ?? [];
    list.push({ scannedAt: r.scannedAt, visitorHash: r.visitorHash });
    out.set(r.campaignId, list);
  }
  return out;
};

/**
 * The QR summary over the given campaigns, or null when none of them carries a QR code (the
 * section is then not shown). `impressions` = the impressions générées of THOSE QR campaigns.
 */
export const qrScanSummaryFor = async (
  campaignsWithImpressions: readonly { id: string; impressions: number }[],
): Promise<(QrScanSummary & { campaignCount: number }) | null> => {
  const qrIds = await loadQrCampaignIds(campaignsWithImpressions.map((c) => c.id));
  if (qrIds.size === 0) return null;
  const scans = await loadScanRows([...qrIds]);
  const rows = [...scans.values()].flat();
  const impressions = campaignsWithImpressions
    .filter((c) => qrIds.has(c.id))
    .reduce((s, c) => s + c.impressions, 0);
  return { ...summarizeScans(rows, impressions), campaignCount: qrIds.size };
};
