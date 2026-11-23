import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  businessSectors,
  governorates,
  screenhostAffluenceHourly,
  screenhosts,
  users,
} from '../db/schema.js';

import { ownerApprovedSql } from './approved-owner.js';
import { casterExcludedVenuesNow } from './caster-exclusions.js';
import { demoVenueIds, isDemoUser } from './demo.js';
import { venueHasInstalledScreenSql } from './installed-screen.js';
import { logosFor } from './logos.js';

// Mariem 17/11/2026 — « Réseau Screenhosts » : the network a Screencaster sees, venue by venue,
// with what he removed from it. The venues are the ones his campaigns can air on: active, an
// approved owner and an installed screen (the pool's own gates, lib/dispatch/exclusion-reason.ts);
// a demo account sees its demo venues instead (DEMO-1). Exclusions live in lib/caster-exclusions.ts.

export type NetworkCategory = 'cafe' | 'resto' | 'sport' | 'autre';

export interface NetworkAgeBand {
  label: string;
  pct: number;
}

export interface NetworkVenue {
  id: string;
  name: string;
  category: NetworkCategory;
  category_label: string;
  region: string | null;
  quartier: string | null;
  csp: 'premium' | 'moyen' | 'populaire' | null;
  male_pct: number | null;
  female_pct: number | null;
  dominant_age: string | null;
  age_bands: NetworkAgeBand[] | null;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  excluded: boolean;
}

export interface NetworkParkLocation {
  screenhost_id: string;
  name: string;
  quartier: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  excluded: boolean;
}

/** « Parcs TV » — one brand present in several locations: an owner with two venues or more. */
export interface NetworkPark {
  id: string;
  name: string;
  category: NetworkCategory;
  category_label: string;
  csp: 'premium' | 'moyen' | 'populaire' | null;
  male_pct: number | null;
  female_pct: number | null;
  dominant_age: string | null;
  age_bands: NetworkAgeBand[] | null;
  logo_url: string | null;
  locations: NetworkParkLocation[];
}

/** A park needs at least this many locations in the Screencaster's network. */
export const PARK_MIN_LOCATIONS = 2;

export interface NetworkView {
  persons_per_month: number | null;
  venues: NetworkVenue[];
}

/** The window of « personnes par mois »: the measured audience of the last 30 days. */
export const NETWORK_AUDIENCE_DAYS = 30;

/** The prototype's three families, from the sector's name; anything else is « autre ». */
export const networkCategory = (sectorName: string | null): NetworkCategory => {
  const n = (sectorName ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (n.includes('sport') || n.includes('gym') || n.includes('fitness')) return 'sport';
  if (n.includes('resto') || n.includes('restaurant') || n.includes('lounge')) return 'resto';
  if (n.includes('cafe') || n.includes('the')) return 'cafe';
  return 'autre';
};

const pctOrNull = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** The venue's age split, in the hub's bands. The two upper bands when the hub sent them, else
 *  the single « 46 ans et plus » it used to send. Null when nothing was ever synced. */
export const networkAgeBands = (v: {
  age17To30Pct: string | null;
  age31To45Pct: string | null;
  age46PlusPct: string | null;
  age46To60Pct: string | null;
  age60PlusPct: string | null;
}): NetworkAgeBand[] | null => {
  const upper =
    v.age46To60Pct !== null || v.age60PlusPct !== null
      ? [
          { label: '46 à 60 ans', pct: pctOrNull(v.age46To60Pct) },
          { label: '60 ans et plus', pct: pctOrNull(v.age60PlusPct) },
        ]
      : [{ label: '46 ans et plus', pct: pctOrNull(v.age46PlusPct) }];
  const bands = [
    { label: '17 à 30 ans', pct: pctOrNull(v.age17To30Pct) },
    { label: '31 à 45 ans', pct: pctOrNull(v.age31To45Pct) },
    ...upper,
  ].flatMap((b) => (b.pct === null ? [] : [{ label: b.label, pct: b.pct }]));
  return bands.length > 0 ? bands : null;
};

/** The band with the largest share (the first one on a tie); null without bands. */
export const dominantAge = (bands: readonly NetworkAgeBand[] | null): string | null =>
  bands === null || bands.length === 0
    ? null
    : bands.reduce((best, b) => (b.pct > best.pct ? b : best)).label;

const numOrNull = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type OwnedVenue = NetworkVenue & { ownerId: string | null; ownerName: string | null };

/** The network with each venue's owner (the parks are grouped on it). */
const loadNetwork = async (
  advertiserId: string,
): Promise<{ persons_per_month: number | null; venues: OwnedVenue[] }> => {
  const demo = (await isDemoUser(db, advertiserId)) ? await demoVenueIds(db) : null;
  const rows = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      sectorName: businessSectors.name,
      region: governorates.name,
      quartier: screenhosts.zone,
      class: screenhosts.class,
      male: screenhosts.genderMalePct,
      female: screenhosts.genderFemalePct,
      age17To30Pct: screenhosts.age17To30Pct,
      age31To45Pct: screenhosts.age31To45Pct,
      age46PlusPct: screenhosts.age46PlusPct,
      age46To60Pct: screenhosts.age46To60Pct,
      age60PlusPct: screenhosts.age60PlusPct,
      latitude: screenhosts.latitude,
      longitude: screenhosts.longitude,
      demoOnly: screenhosts.demoOnly,
      ownerId: screenhosts.ownerId,
      ownerBusiness: users.businessName,
      ownerContact: users.contactName,
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .leftJoin(governorates, eq(screenhosts.governorateId, governorates.id))
    .leftJoin(users, eq(screenhosts.ownerId, users.id))
    .where(
      and(
        eq(screenhosts.isActive, true),
        or(and(ownerApprovedSql(), venueHasInstalledScreenSql()), eq(screenhosts.demoOnly, true)),
      ),
    )
    .orderBy(asc(screenhosts.name));
  const visible = rows.filter((r) => (demo ? demo.has(r.id) : !r.demoOnly));
  const ids = visible.map((r) => r.id);
  const excluded = await casterExcludedVenuesNow(db, advertiserId);
  const logos = await logosFor(
    ids.map((id) => ({ kind: 'screenhost' as const, id })),
    null,
  );

  let personsPerMonth: number | null = null;
  if (ids.length > 0) {
    // One value per measured (venue, day, hour): the rounded mean of its half-hour cells, summed
    // over the window (the public counters' own reading of the hub's measures).
    const hourCells = db
      .select({
        value: sql<number>`round(avg(${screenhostAffluenceHourly.value}))`.as('value'),
      })
      .from(screenhostAffluenceHourly)
      .where(
        and(
          inArray(screenhostAffluenceHourly.screenhostId, ids),
          sql`${screenhostAffluenceHourly.value} is not null`,
          sql`${screenhostAffluenceHourly.date} >= (now() at time zone 'Africa/Tunis')::date - ${NETWORK_AUDIENCE_DAYS}::int`,
        ),
      )
      .groupBy(
        screenhostAffluenceHourly.screenhostId,
        screenhostAffluenceHourly.date,
        screenhostAffluenceHourly.hour,
      )
      .as('hour_cells');
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${hourCells.value}), 0)` })
      .from(hourCells);
    const total = Number(row?.total ?? 0);
    personsPerMonth = Number.isFinite(total) && total > 0 ? Math.round(total) : null;
  }

  return {
    persons_per_month: personsPerMonth,
    venues: visible.map((r) => {
      const bands = networkAgeBands(r);
      return {
        id: r.id,
        name: r.name,
        category: networkCategory(r.sectorName),
        category_label: r.sectorName ?? 'Établissement',
        region: r.region,
        quartier: r.quartier,
        csp: r.class,
        male_pct: pctOrNull(r.male),
        female_pct: pctOrNull(r.female),
        dominant_age: dominantAge(bands),
        age_bands: bands,
        latitude: numOrNull(r.latitude),
        longitude: numOrNull(r.longitude),
        logo_url: logos.get(r.id)?.url ?? null,
        excluded: excluded.has(r.id),
        ownerId: r.ownerId,
        ownerName: r.ownerBusiness ?? r.ownerContact,
      };
    }),
  };
};

/** The Screencaster's network: every venue his campaigns can use, the excluded ones flagged. */
export const networkFor = async (advertiserId: string): Promise<NetworkView> => {
  const { persons_per_month, venues } = await loadNetwork(advertiserId);
  return {
    persons_per_month,
    venues: venues.map((v) => {
      const venue: NetworkVenue & { ownerId?: string | null; ownerName?: string | null } = { ...v };
      delete venue.ownerId;
      delete venue.ownerName;
      return venue;
    }),
  };
};

/** The value most venues share (the first one met on a tie); null when none has one. */
export const mostCommon = <T>(values: readonly (T | null)[]): T | null => {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
};

const meanOrNull = (values: readonly (number | null)[]): number | null => {
  const known = values.flatMap((v) => (v === null ? [] : [v]));
  return known.length === 0 ? null : Math.round(known.reduce((a, b) => a + b, 0) / known.length);
};

/** The mean age split of the venues that have one, band by band (labels of the first split). */
export const meanAgeBands = (
  splits: readonly (readonly NetworkAgeBand[] | null)[],
): NetworkAgeBand[] | null => {
  const known = splits.flatMap((s) => (s === null ? [] : [s]));
  const labels = known[0]?.map((b) => b.label);
  if (!labels) return null;
  return labels.map((label) => ({
    label,
    pct: meanOrNull(known.map((s) => s.find((b) => b.label === label)?.pct ?? null)) ?? 0,
  }));
};

/**
 * « Parcs TV » — the parks of the Screencaster's network: every owner with PARK_MIN_LOCATIONS
 * venues or more in it, under the owner's business name. A park's profile is its locations':
 * the category and CSP most of them share, the mean of their audience splits. There is no park
 * table: a park exists the day an owner has a second venue in the network.
 */
export const parksFor = async (advertiserId: string): Promise<NetworkPark[]> => {
  const { venues } = await loadNetwork(advertiserId);
  const byOwner = new Map<string, OwnedVenue[]>();
  for (const v of venues) {
    if (v.ownerId === null) continue;
    byOwner.set(v.ownerId, [...(byOwner.get(v.ownerId) ?? []), v]);
  }
  return [...byOwner.entries()]
    .filter(([, list]) => list.length >= PARK_MIN_LOCATIONS)
    .map(([ownerId, list]) => {
      const category = mostCommon(list.map((v) => v.category)) ?? 'autre';
      const bands = meanAgeBands(list.map((v) => v.age_bands));
      return {
        id: ownerId,
        name: list[0]?.ownerName ?? list[0]?.name ?? 'Parc',
        category,
        category_label:
          list.find((v) => v.category === category)?.category_label ?? 'Établissement',
        csp: mostCommon(list.map((v) => v.csp)),
        male_pct: meanOrNull(list.map((v) => v.male_pct)),
        female_pct: meanOrNull(list.map((v) => v.female_pct)),
        dominant_age: dominantAge(bands),
        age_bands: bands,
        logo_url: list.find((v) => v.logo_url !== null)?.logo_url ?? null,
        locations: list.map((v) => ({
          screenhost_id: v.id,
          name: v.name,
          quartier: v.quartier,
          region: v.region,
          latitude: v.latitude,
          longitude: v.longitude,
          excluded: v.excluded,
        })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
};

/** The ids among `screenhostIds` that belong to the Screencaster's network (excludable by him). */
export const networkVenueIds = async (
  advertiserId: string,
  screenhostIds: readonly string[],
): Promise<string[]> => {
  if (screenhostIds.length === 0) return [];
  const wanted = new Set(screenhostIds);
  const view = await networkFor(advertiserId);
  return view.venues.filter((v) => wanted.has(v.id)).map((v) => v.id);
};
