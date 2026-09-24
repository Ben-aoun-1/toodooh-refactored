import { getISODay, parseISO } from 'date-fns';
import { and, desc, eq, inArray, count as countRows, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  proofOfPlay,
  screenhostAffluence,
  screenhosts,
  zones,
} from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
import { ttcFromHt } from './facture.js';
import { collapseHalvesSql, inEffectSql } from './half-hour-slots.js';
import { displayImpressionsSettled } from './impressions-display.js';
import { proofInstantSql } from './playout/proof-instant.js';
import { sectorDisplayName } from './report/sector-display-name.js';

// SC-P — « Mes performances » for the SCREENCASTER (Mejri, UserStories_Mes_Performances_v2,
// 2026-08-04; ruled THE spec 2026-09-12). ONE home for every figure the page shows, so the
// history, the last report, the footprint, the analysis sections and the PDF can never disagree.
//
// THE DATA CONTRACT (recon, 2026-09-12):
//   • clôture            = campaign_reconciliation.reconciled_at — the ONE row both settlement
//                          paths write (lib/reconcile for classic campaigns, lib/event-playout/
//                          settlement for positionings). A campaign is CLOSED iff that row exists;
//                          period membership (RG-PERF-16) is its Tunis calendar date.
//   • impressions générées = displayImpressionsSettled(campaign_reconciliation) = delivered_imp —
//                          NET-IMP1 (« prédites − perdues », Mejri 2026-08-04): the SAME helper
//                          the owner side consumes, no second computation.
//   • per-venue impressions = campaign_screenhost_payout.delivered_imp (both paths write it) —
//                          the weights behind sections 02 (catégorie), 03 (CSP + profil) and 04
//                          (zone); the venue's category/class/zone/ratios ride screenhosts.
//   • heures de diffusion = venue-hours CREDITED by the engine: a (venue, Tunis date, hour) with
//                          ≥ 1 VIDEO_ENDED proof (the reconcile's own FIX A bucketing), kept only
//                          when it is a planned créneau for a classic campaign (the V1 player
//                          loops the playlist, so proofs can land outside the plan; those earn
//                          neither impressions nor hours). A positioning has no hourly plan —
//                          every proof hour counts. RG-PERF-04: NEVER « personnes touchées ».
//   • diffusions du spot  = COUNT(VIDEO_ENDED proofs) — raw plays, the honest « nombre de fois
//                          où votre spot a été joué ».
//   • établissements diffuseurs = venues with delivered_imp > 0 in the payouts (closed) / with
//                          ≥ 1 proof (live). Period mode sums per campaign WITHOUT dedup (the
//                          spec's glossary is normative — do NOT « fix »).
//   • budget HT           = spend_tnd + refund_tnd — the ENGAGED budget on both paths (classic:
//                          spend = budget − refund; event: spend = delivered, refund = the rest).
//                          Everything upstream of a PDF is HT; TTC = facture.ts's one rate.
//   • audience (live)     = Σ over the credited hours of the venue's typical affluence at
//                          (weekday, hour) — screenhost_affluence, hour-collapsed, in_effect —
//                          « people present in the venue while the spot aired ». NULL when no
//                          venue of the campaign has a grid (never a zero dressed as a result).
//   • profil sexe / âge   = per-venue delivered impressions × the hub's ratios (Lane D columns);
//                          a venue without ratios is counted as « non profilé », surfaced as such.
//                          Age bands are THREE (CLS-AGE1, Mejri 2026-09-03) — the simulator's four
//                          are superseded; flagged at CF-9.
// NO CPM, NO SPS, NO indice d'attention, NO split key leaves this module (RG-PERF-31) — the
// payout's earnings_tnd and the plan's cpm are deliberately never selected.

export type CampaignNature = 'normal' | 'event';

export const natureOf = (eventId: string | null): CampaignNature =>
  eventId === null ? 'normal' : 'event';

export type VenueClass = 'populaire' | 'moyen' | 'premium';
export type CspKey = VenueClass | 'non_renseigne';
export const CSP_KEYS: readonly CspKey[] = ['populaire', 'moyen', 'premium', 'non_renseigne'];

/** A closed campaign with its settled figures. */
export interface ClosedCampaign {
  id: string;
  name: string;
  nature: CampaignNature;
  startDate: string | null;
  endDate: string | null;
  closedAt: Date;
  /** The Tunis calendar date of the clôture — RG-PERF-16 membership key. */
  closedOn: string;
  budgetHt: number;
  budgetTtc: number;
  impressions: number;
  hours: number;
  plays: number;
  venues: number;
}

/** A campaign en diffusion (started, not closed) with its live counters. */
export interface LiveCampaign {
  id: string;
  name: string;
  nature: CampaignNature;
  launchedOn: string | null;
  /** null = no affluence grid behind any credited hour (source missing, not zero). */
  audience: number | null;
  plays: number;
  venues: number;
}

/** One venue's delivered impressions with the attributes the sections group by. */
export interface VenueImpressionLine {
  campaignId: string;
  screenhostId: string;
  impressions: number;
  category: string | null;
  venueClass: VenueClass | null;
  zoneId: string | null;
  zoneName: string | null;
  ratios: VenueRatios | null;
}

export interface VenueRatios {
  genderFemalePct: number;
  genderMalePct: number;
  age17To30Pct: number;
  age31To45Pct: number;
  age46PlusPct: number;
}

export interface ShareRow<K extends string = string> {
  key: K;
  label: string;
  value: number;
  /** 0–100, rounded to 1 decimal; 0 when the total is 0. */
  pct: number;
}

export interface AudienceProfile {
  profiledImpressions: number;
  unprofiledImpressions: number;
  unprofiledVenues: number;
  sex: ShareRow<'femmes' | 'hommes'>[];
  age: ShareRow<'age_17_30' | 'age_31_45' | 'age_46_plus'>[];
}

export interface CampaignCharacteristics {
  /** Top categories by impressions (display names). */
  categories: string[];
  /** Every CSP class with its share of the campaign's impressions (the web applies Q7's 12 %). */
  cspShares: ShareRow<CspKey>[];
}

export interface AnalysisSections {
  campaigns: (ClosedCampaign & CampaignCharacteristics)[];
  overview: {
    campaignCount: number;
    impressions: number;
    hours: number;
    plays: number;
    venues: number;
    budgetHt: number;
    budgetTtc: number;
  };
  categories: ShareRow[];
  csp: ShareRow<CspKey>[];
  /** null when no impressions at all (nothing to profile). */
  audience: AudienceProfile | null;
  /** Every active zone of the catalogue, covered or not (the web flags < 5 %). */
  zones: (ShareRow & { zoneId: string | null })[];
}

export interface FootprintPoint {
  closedOn: string;
  campaignId: string;
  name: string;
  impressions: number;
  hours: number;
  impressionsCumulative: number;
  hoursCumulative: number;
}

const CSP_LABELS: Record<CspKey, string> = {
  populaire: 'Populaire',
  moyen: 'Moyen',
  premium: 'Premium',
  non_renseigne: 'Non renseigné',
};

export const UNCATEGORIZED_LABEL = 'Autres établissements';
export const UNZONED_LABEL = 'Hors zone';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── pure helpers (pinned by tests) ─────────────────────────────────────────────────────────

/** RG-PERF-16 — a campaign belongs to a period iff its clôture date falls in [from, to]. */
export const closedInPeriod = (closedOn: string, from: string | null, to: string | null): boolean =>
  (from === null || closedOn >= from) && (to === null || closedOn <= to);

/** Percent shares of a labelled set of values (1-decimal, 0 on an empty total). */
export const shareRows = <K extends string>(
  entries: readonly { key: K; label: string; value: number }[],
): ShareRow<K>[] => {
  const total = entries.reduce((s, e) => s + e.value, 0);
  return entries.map((e) => ({
    key: e.key,
    label: e.label,
    value: e.value,
    pct: total > 0 ? round1((e.value / total) * 100) : 0,
  }));
};

const slotKeyOf = (screenhostId: string, date: string, hour: number): string =>
  `${screenhostId}|${date}:${hour}`;

/** Sum a Map<key, number> entry. */
const bump = <K>(map: Map<K, number>, key: K, by: number): void => {
  map.set(key, (map.get(key) ?? 0) + by);
};

/**
 * Section 03's audience profile: each venue's delivered impressions split by the hub's ratios;
 * venues without ratios are reported apart, never silently dropped into a denominator.
 */
export const audienceProfile = (lines: readonly VenueImpressionLine[]): AudienceProfile | null => {
  const total = lines.reduce((s, l) => s + l.impressions, 0);
  if (total <= 0) return null;
  let profiled = 0;
  let unprofiled = 0;
  const unprofiledVenues = new Set<string>();
  const acc = { femmes: 0, hommes: 0, age_17_30: 0, age_31_45: 0, age_46_plus: 0 };
  for (const l of lines) {
    if (l.impressions <= 0) continue;
    if (l.ratios === null) {
      unprofiled += l.impressions;
      unprofiledVenues.add(l.screenhostId);
      continue;
    }
    profiled += l.impressions;
    acc.femmes += (l.impressions * l.ratios.genderFemalePct) / 100;
    acc.hommes += (l.impressions * l.ratios.genderMalePct) / 100;
    acc.age_17_30 += (l.impressions * l.ratios.age17To30Pct) / 100;
    acc.age_31_45 += (l.impressions * l.ratios.age31To45Pct) / 100;
    acc.age_46_plus += (l.impressions * l.ratios.age46PlusPct) / 100;
  }
  return {
    profiledImpressions: profiled,
    unprofiledImpressions: unprofiled,
    unprofiledVenues: unprofiledVenues.size,
    sex: shareRows([
      { key: 'femmes', label: 'Femmes', value: Math.round(acc.femmes) },
      { key: 'hommes', label: 'Hommes', value: Math.round(acc.hommes) },
    ]),
    age: shareRows([
      { key: 'age_17_30', label: '17 - 30 ans', value: Math.round(acc.age_17_30) },
      { key: 'age_31_45', label: '31 - 45 ans', value: Math.round(acc.age_31_45) },
      { key: 'age_46_plus', label: '46 ans et plus', value: Math.round(acc.age_46_plus) },
    ]),
  };
};

/** Section 02/03/04 groupings for a set of venue lines. */
const cspRowsOf = (lines: readonly VenueImpressionLine[]): ShareRow<CspKey>[] => {
  const by = new Map<CspKey, number>();
  for (const l of lines) bump(by, l.venueClass ?? 'non_renseigne', l.impressions);
  return shareRows(
    CSP_KEYS.filter((k) => k !== 'non_renseigne' || (by.get(k) ?? 0) > 0).map((k) => ({
      key: k,
      label: CSP_LABELS[k],
      value: by.get(k) ?? 0,
    })),
  );
};

const categoryRowsOf = (lines: readonly VenueImpressionLine[]): ShareRow[] => {
  const by = new Map<string, number>();
  for (const l of lines) bump(by, l.category ?? UNCATEGORIZED_LABEL, l.impressions);
  return shareRows(
    [...by.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
      .map(([name, value]) => ({ key: name, label: name, value })),
  );
};

const zoneRowsOf = (
  lines: readonly VenueImpressionLine[],
  catalogue: readonly { id: string; name: string }[],
): (ShareRow & { zoneId: string | null })[] => {
  const by = new Map<string | null, number>();
  for (const l of lines) bump(by, l.zoneId, l.impressions);
  const rows: (ShareRow & { zoneId: string | null })[] = shareRows(
    catalogue.map((z) => ({ key: z.id, label: z.name, value: by.get(z.id) ?? 0 })),
  ).map((r) => ({ ...r, zoneId: r.key }));
  // Venues outside the active catalogue (a NULL zone, or a deactivated one) still carry
  // impressions — surfaced as one honest « Hors zone » line rather than vanishing.
  const known = new Set(catalogue.map((z) => z.id));
  const stray = [...by.entries()]
    .filter(([id]) => id === null || !known.has(id))
    .reduce((s, [, v]) => s + v, 0);
  if (stray > 0) {
    const total = lines.reduce((s, l) => s + l.impressions, 0);
    rows.push({
      key: 'hors_zone',
      label: UNZONED_LABEL,
      value: stray,
      pct: total > 0 ? round1((stray / total) * 100) : 0,
      zoneId: null,
    });
    // Recompute every pct against the FULL total (the catalogue rows above summed to 100 alone).
    for (const r of rows) r.pct = total > 0 ? round1((r.value / total) * 100) : 0;
  }
  return rows;
};

/** The analysis sections 01–04 over a set of closed campaigns (one = Campaign mode). */
export const buildAnalysis = (
  scoped: readonly ClosedCampaign[],
  lines: readonly VenueImpressionLine[],
  zoneCatalogue: readonly { id: string; name: string }[],
): AnalysisSections => {
  const ids = new Set(scoped.map((c) => c.id));
  const inScope = lines.filter((l) => ids.has(l.campaignId));
  const overview = scoped.reduce(
    (o, c) => ({
      campaignCount: o.campaignCount + 1,
      impressions: o.impressions + c.impressions,
      hours: o.hours + c.hours,
      plays: o.plays + c.plays,
      venues: o.venues + c.venues, // simple sum, NO cross-campaign dedup (normative)
      budgetHt: round2(o.budgetHt + c.budgetHt),
      budgetTtc: 0,
    }),
    { campaignCount: 0, impressions: 0, hours: 0, plays: 0, venues: 0, budgetHt: 0, budgetTtc: 0 },
  );
  overview.budgetTtc = ttcFromHt(overview.budgetHt);
  return {
    campaigns: scoped.map((c) => {
      const own = inScope.filter((l) => l.campaignId === c.id);
      return {
        ...c,
        categories: categoryRowsOf(own)
          .filter((r) => r.value > 0)
          .slice(0, 2)
          .map((r) => r.label),
        cspShares: cspRowsOf(own),
      };
    }),
    overview,
    categories: categoryRowsOf(inScope),
    csp: cspRowsOf(inScope),
    audience: audienceProfile(inScope),
    zones: zoneRowsOf(inScope, zoneCatalogue),
  };
};

/** Epic 5 — cumulative impressions + hours over the clôtures, oldest first. */
export const footprintSeries = (closed: readonly ClosedCampaign[]): FootprintPoint[] => {
  const chrono = [...closed].sort(
    (a, b) => a.closedAt.getTime() - b.closedAt.getTime() || a.name.localeCompare(b.name, 'fr'),
  );
  let imp = 0;
  let hrs = 0;
  return chrono.map((c) => {
    imp += c.impressions;
    hrs += c.hours;
    return {
      closedOn: c.closedOn,
      campaignId: c.id,
      name: c.name,
      impressions: c.impressions,
      hours: c.hours,
      impressionsCumulative: imp,
      hoursCumulative: hrs,
    };
  });
};

// ── DB readers ─────────────────────────────────────────────────────────────────────────────

interface ProofSlot {
  campaignId: string;
  screenhostId: string;
  date: string;
  hour: number;
  plays: number;
}

/** VIDEO_ENDED proofs bucketed per (campaign, venue, Tunis date, Tunis hour) — FIX A grid. */
const loadProofSlots = async (campaignIds: readonly string[]): Promise<ProofSlot[]> => {
  if (campaignIds.length === 0) return [];
  // PROOF-R1 — bucketed on the PLAY instant (a replayed proof credits the hour it aired).
  const tunisDate = sql<string>`to_char(${proofInstantSql} at time zone 'Africa/Tunis', 'YYYY-MM-DD')`;
  const tunisHour = sql<number>`extract(hour from ${proofInstantSql} at time zone 'Africa/Tunis')::int`;
  const rows = await db
    .select({
      campaignId: proofOfPlay.campaignId,
      screenhostId: proofOfPlay.screenhostId,
      date: tunisDate,
      hour: tunisHour,
      plays: countRows(),
    })
    .from(proofOfPlay)
    .where(
      and(
        inArray(proofOfPlay.campaignId, [...campaignIds]),
        eq(proofOfPlay.eventType, 'VIDEO_ENDED'),
      ),
    )
    .groupBy(proofOfPlay.campaignId, proofOfPlay.screenhostId, tunisDate, tunisHour);
  return rows.map((r) => ({ ...r, hour: Number(r.hour), plays: Number(r.plays) }));
};

/** The planned créneau keys per classic campaign (Map<campaignId, Set<venue|date:hour>>). */
const loadPlannedSlotKeys = async (
  classicIds: readonly string[],
): Promise<Map<string, Set<string>>> => {
  const out = new Map<string, Set<string>>();
  if (classicIds.length === 0) return out;
  const rows = await db
    .select({
      campaignId: campaignDispatchPlan.campaignId,
      screenhostId: campaignDispatchAllocation.screenhostId,
      creneaux: campaignDispatchAllocation.creneaux,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .where(inArray(campaignDispatchPlan.campaignId, [...classicIds]));
  for (const r of rows) {
    let set = out.get(r.campaignId);
    if (!set) {
      set = new Set<string>();
      out.set(r.campaignId, set);
    }
    for (const c of r.creneaux) set.add(slotKeyOf(r.screenhostId, c.date, c.hour));
  }
  return out;
};

interface CreditedDiffusion {
  /** Credited (venue, date, hour) slots. */
  slots: ProofSlot[];
  plays: number;
  venuesWithProof: number;
}

/** Per campaign: the credited hours (plan-intersected for classics), raw plays, venues. */
const creditedDiffusion = async (
  targets: readonly { id: string; nature: CampaignNature }[],
): Promise<Map<string, CreditedDiffusion>> => {
  const out = new Map<string, CreditedDiffusion>();
  for (const t of targets) out.set(t.id, { slots: [], plays: 0, venuesWithProof: 0 });
  const proofSlots = await loadProofSlots(targets.map((t) => t.id));
  const planned = await loadPlannedSlotKeys(
    targets.filter((t) => t.nature === 'normal').map((t) => t.id),
  );
  const natureById = new Map(targets.map((t) => [t.id, t.nature]));
  const venuesBy = new Map<string, Set<string>>();
  for (const s of proofSlots) {
    const entry = out.get(s.campaignId);
    if (!entry) continue;
    entry.plays += s.plays;
    let venues = venuesBy.get(s.campaignId);
    if (!venues) {
      venues = new Set<string>();
      venuesBy.set(s.campaignId, venues);
    }
    venues.add(s.screenhostId);
    const isPlanned =
      natureById.get(s.campaignId) === 'event' ||
      (planned.get(s.campaignId)?.has(slotKeyOf(s.screenhostId, s.date, s.hour)) ?? false);
    if (isPlanned) entry.slots.push(s);
  }
  for (const [id, venues] of venuesBy) {
    const entry = out.get(id);
    if (entry) entry.venuesWithProof = venues.size;
  }
  return out;
};

/** Venues that actually aired, per closed campaign (payouts with delivered_imp > 0). */
const loadDeliveringVenueCounts = async (
  campaignIds: readonly string[],
): Promise<Map<string, number>> => {
  if (campaignIds.length === 0) return new Map();
  const rows = await db
    .select({ campaignId: campaignScreenhostPayout.campaignId, venues: countRows() })
    .from(campaignScreenhostPayout)
    .where(
      and(
        inArray(campaignScreenhostPayout.campaignId, [...campaignIds]),
        sql`${campaignScreenhostPayout.deliveredImp} > 0`,
      ),
    )
    .groupBy(campaignScreenhostPayout.campaignId);
  return new Map(rows.map((r) => [r.campaignId, Number(r.venues)]));
};

/** The advertiser's CLOSED campaigns with their settled figures, newest clôture first. */
export const loadClosedCampaigns = async (advertiserId: string): Promise<ClosedCampaign[]> => {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      eventId: campaigns.eventId,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      closedAt: campaignReconciliation.reconciledAt,
      expectedImp: campaignReconciliation.expectedImp,
      deliveredImp: campaignReconciliation.deliveredImp,
      spendTnd: campaignReconciliation.spendTnd,
      refundTnd: campaignReconciliation.refundTnd,
    })
    .from(campaigns)
    .innerJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(eq(campaigns.advertiserId, advertiserId))
    .orderBy(desc(campaignReconciliation.reconciledAt), desc(campaigns.createdAt));
  const targets = rows.map((r) => ({ id: r.id, nature: natureOf(r.eventId) }));
  const [diffusion, venueCounts] = await Promise.all([
    creditedDiffusion(targets),
    loadDeliveringVenueCounts(rows.map((r) => r.id)),
  ]);
  return rows.map((r) => {
    const d = diffusion.get(r.id);
    const budgetHt = round2(Number(r.spendTnd) + Number(r.refundTnd));
    return {
      id: r.id,
      name: r.name,
      nature: natureOf(r.eventId),
      startDate: r.startDate,
      endDate: r.endDate,
      closedAt: r.closedAt,
      closedOn: tunisDateOf(r.closedAt),
      budgetHt,
      budgetTtc: ttcFromHt(budgetHt),
      impressions: displayImpressionsSettled({
        expectedImp: r.expectedImp,
        deliveredImp: r.deliveredImp,
      }),
      hours: d?.slots.length ?? 0,
      plays: d?.plays ?? 0,
      venues: venueCounts.get(r.id) ?? 0,
    };
  });
};

const ratiosOf = (r: {
  genderFemalePct: string | null;
  genderMalePct: string | null;
  age17To30Pct: string | null;
  age31To45Pct: string | null;
  age46PlusPct: string | null;
}): VenueRatios | null => {
  if (
    r.genderFemalePct === null ||
    r.genderMalePct === null ||
    r.age17To30Pct === null ||
    r.age31To45Pct === null ||
    r.age46PlusPct === null
  ) {
    return null;
  }
  return {
    genderFemalePct: Number(r.genderFemalePct),
    genderMalePct: Number(r.genderMalePct),
    age17To30Pct: Number(r.age17To30Pct),
    age31To45Pct: Number(r.age31To45Pct),
    age46PlusPct: Number(r.age46PlusPct),
  };
};

/** Per-venue delivered impressions + the venue attributes the sections group by. */
export const loadVenueImpressionLines = async (
  campaignIds: readonly string[],
): Promise<VenueImpressionLine[]> => {
  if (campaignIds.length === 0) return [];
  const rows = await db
    .select({
      campaignId: campaignScreenhostPayout.campaignId,
      screenhostId: campaignScreenhostPayout.screenhostId,
      deliveredImp: campaignScreenhostPayout.deliveredImp,
      sectorName: businessSectors.name,
      venueClass: screenhosts.class,
      zoneId: screenhosts.zoneId,
      zoneName: zones.name,
      genderFemalePct: screenhosts.genderFemalePct,
      genderMalePct: screenhosts.genderMalePct,
      age17To30Pct: screenhosts.age17To30Pct,
      age31To45Pct: screenhosts.age31To45Pct,
      age46PlusPct: screenhosts.age46PlusPct,
    })
    .from(campaignScreenhostPayout)
    .innerJoin(screenhosts, eq(screenhosts.id, campaignScreenhostPayout.screenhostId))
    .leftJoin(businessSectors, eq(businessSectors.id, screenhosts.businessSectorId))
    .leftJoin(zones, eq(zones.id, screenhosts.zoneId))
    .where(inArray(campaignScreenhostPayout.campaignId, [...campaignIds]));
  return rows.map((r) => ({
    campaignId: r.campaignId,
    screenhostId: r.screenhostId,
    impressions: r.deliveredImp,
    category: r.sectorName === null ? null : sectorDisplayName(r.sectorName),
    venueClass: r.venueClass,
    zoneId: r.zoneId,
    zoneName: r.zoneName,
    ratios: ratiosOf(r),
  }));
};

/** The active zone catalogue (section 04 lists every zone, covered or not). */
export const loadZoneCatalogue = async (): Promise<{ id: string; name: string }[]> =>
  db
    .select({ id: zones.id, name: zones.name })
    .from(zones)
    .where(eq(zones.active, true))
    .orderBy(zones.name);

/**
 * Epic 1 — campaigns en diffusion: status 'active' (start reached) with NO reconciliation row,
 * newest launch first (US-1.2 hypothesis). Counters read the proofs as they land.
 */
export const loadLiveCampaigns = async (advertiserId: string): Promise<LiveCampaign[]> => {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      eventId: campaigns.eventId,
      startDate: campaigns.startDate,
      activatedAt: campaigns.activatedAt,
    })
    .from(campaigns)
    .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.advertiserId, advertiserId),
        eq(campaigns.status, 'active'),
        sql`${campaignReconciliation.id} is null`,
      ),
    )
    .orderBy(desc(campaigns.startDate), desc(campaigns.activatedAt), desc(campaigns.createdAt));
  if (rows.length === 0) return [];
  const targets = rows.map((r) => ({ id: r.id, nature: natureOf(r.eventId) }));
  const diffusion = await creditedDiffusion(targets);

  // Affluence behind the credited hours: the venue's typical (weekday, hour) level.
  const venueIds = [
    ...new Set([...diffusion.values()].flatMap((d) => d.slots.map((s) => s.screenhostId))),
  ];
  const affluence = new Map<string, number>();
  if (venueIds.length > 0) {
    const grid = await db
      .select({
        screenhostId: screenhostAffluence.screenhostId,
        dayOfWeek: screenhostAffluence.dayOfWeek,
        hour: screenhostAffluence.hour,
        level: collapseHalvesSql(screenhostAffluence.estimatedImpressions),
      })
      .from(screenhostAffluence)
      .where(
        and(
          inArray(screenhostAffluence.screenhostId, venueIds),
          inEffectSql(screenhostAffluence.inEffect),
        ),
      )
      .groupBy(
        screenhostAffluence.screenhostId,
        screenhostAffluence.dayOfWeek,
        screenhostAffluence.hour,
      );
    for (const g of grid) {
      affluence.set(`${g.screenhostId}|${g.dayOfWeek}:${g.hour}`, Number(g.level));
    }
  }

  return rows.map((r) => {
    const d = diffusion.get(r.id);
    let audience = 0;
    let matched = false;
    for (const s of d?.slots ?? []) {
      const dow = getISODay(parseISO(s.date));
      const level = affluence.get(`${s.screenhostId}|${dow}:${s.hour}`);
      if (level !== undefined) {
        matched = true;
        audience += level;
      }
    }
    return {
      id: r.id,
      name: r.name,
      nature: natureOf(r.eventId),
      launchedOn: r.startDate ?? (r.activatedAt ? tunisDateOf(r.activatedAt) : null),
      // No credited hour yet → 0 aired (true). Hours credited but no grid → unknown (null).
      audience: (d?.slots.length ?? 0) === 0 ? 0 : matched ? audience : null,
      plays: d?.plays ?? 0,
      venues: d?.venuesWithProof ?? 0,
    };
  });
};
