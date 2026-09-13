import { addIsoDays, broadcastableHours } from '../../lib/opening-hours.js';

import { type Rng, createRng } from './rng.js';
import {
  CLASS_DEMOGRAPHICS,
  OWNER_SECTORS,
  VENUE_CLASSES,
  WEEKDAY_FACTOR,
  type VenueClass,
} from './sectors.js';

// SIM-1 — the PURE world spec. `generateWorld` is a function of its params alone (the seed
// included): same params → byte-identical spec, which is what makes a world reproducible and the
// determinism test possible. Nothing here touches the database, the clock, or the network; the
// writer (write.ts) turns this object into rows inside the sandbox.

export interface WorldParams {
  seed: string;
  venues: number;
  owners: number;
  advertisers: number;
  agents: number;
  historyDays: number;
  walletMinTnd: number;
  walletMaxTnd: number;
  /** The Tunis calendar day of the simulation's virtual clock — history stops the day before. */
  virtualToday: string;
}

export interface PersonSpec {
  id: string;
  email: string;
  contactName: string;
  businessName: string;
}

export interface OwnerSpec extends PersonSpec {
  role: 'individual_owner' | 'fleet_owner';
  /** Share of campaign proposals this owner accepts (SIM-2 reads it from simulation_actors). */
  acceptanceRate: number;
  /** How long the owner sits on a proposal before answering, in virtual hours. */
  responseDelayHours: number;
}

export interface AdvertiserSpec extends PersonSpec {
  walletTnd: number;
  rechargeReference: string;
}

export interface AgentSpec extends PersonSpec {
  role: 'screenhost_agent' | 'screencast_agent';
  code: string;
}

export interface ScreenSpec {
  id: string;
  name: string;
  /** Per-hour chance the screen is dark (SIM-2 reads it from simulation_actors). */
  offlineProbability: number;
}

export interface VenueDemographics {
  genderMalePct: number;
  genderFemalePct: number;
  age17To30Pct: number;
  age31To45Pct: number;
  age46PlusPct: number;
}

export interface VenueSpec {
  id: string;
  name: string;
  sector: string;
  venueClass: VenueClass;
  ownerId: string;
  openingHour: number;
  closingHour: number;
  broadcastCapacity: number;
  sps: number;
  latitude: number;
  longitude: number;
  address: string;
  screens: ScreenSpec[];
  demographics: VenueDemographics;
  /** Typical week, [dayOfWeek 1–7 minus one][clock hour 0–23] → persons in that hour. */
  grid: number[][];
}

export interface ReferralSpec {
  agentId: string;
  agentCode: string;
  referredId: string;
}

export interface WorldSpec {
  seed: string;
  params: WorldParams;
  owners: OwnerSpec[];
  advertisers: AdvertiserSpec[];
  agents: AgentSpec[];
  venues: VenueSpec[];
  referrals: ReferralSpec[];
}

const FIRST_NAMES = [
  'Mohamed',
  'Amine',
  'Sonia',
  'Yassine',
  'Nadia',
  'Karim',
  'Rania',
  'Slim',
  'Ines',
  'Hatem',
  'Leila',
  'Sami',
  'Dorra',
  'Bilel',
  'Emna',
  'Walid',
  'Salma',
  'Khaled',
  'Mariem',
  'Anis',
] as const;
const LAST_NAMES = [
  'Ben Aoun',
  'Trabelsi',
  'Gharbi',
  'Chaabane',
  'Mejri',
  'Bouazizi',
  'Hammami',
  'Jaziri',
  'Khelifi',
  'Sassi',
  'Ayari',
  'Ferchichi',
  'Zouari',
  'Haddad',
  'Mabrouk',
  'Nasri',
] as const;
const VENUE_PREFIX: Record<string, readonly string[]> = {
  Café: ['Café', 'Café des', 'Grand Café'],
  Resto: ['Restaurant', 'Chez', 'Le'],
  'Resto/Bar': ['Bar', 'Lounge', 'Le'],
  'Salle de sport': ['Fitness', 'Gym', 'Club'],
  'Espace de loisir': ['Espace', 'Complexe', 'Parc'],
};
const VENUE_WORD = [
  'Carthage',
  'Medina',
  'Lac',
  'Marsa',
  'Menzah',
  'Ennasr',
  'Bardo',
  'Kram',
  'Soukra',
  'Ariana',
  'Gammarth',
  'Manar',
  'Jasmin',
  'Olivier',
  'Corniche',
  'Palmier',
] as const;
const STREETS = [
  'Avenue Habib Bourguiba',
  'Rue de Marseille',
  'Avenue de la Liberté',
  'Rue Ibn Khaldoun',
  'Avenue Mohamed V',
  'Rue du Lac Léman',
  'Avenue Taieb Mhiri',
  'Rue de Rome',
] as const;

/** Reserved TLD — a generated address can never be delivered to a real mailbox. */
const EMAIL_DOMAIN = 'simulateur.invalid';

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const person = (rng: Rng, index: number, kind: string): PersonSpec => {
  const contactName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  return {
    id: rng.uuid(),
    email: `sim.${kind}.${index + 1}.${slug(contactName)}@${EMAIL_DOMAIN}`,
    contactName,
    businessName: `${contactName} ${kind === 'adv' ? 'SARL' : 'SUARL'}`,
  };
};

/** Persons in an hour for one venue: the sector curve scaled by class, weekday and a venue jitter. */
const venueGrid = (rng: Rng, curve: readonly number[], scale: number): number[][] =>
  Array.from({ length: 7 }, (_, dowIndex) =>
    Array.from({ length: 24 }, (_, hour) => {
      const base = curve[hour] ?? 0;
      if (base === 0) return 0;
      const jitter = rng.float(0.9, 1.1);
      return Math.max(1, Math.round(base * scale * (WEEKDAY_FACTOR[dowIndex] ?? 1) * jitter));
    }),
  );

export const generateWorld = (params: WorldParams): WorldSpec => {
  const rng = createRng(params.seed);

  const agents: AgentSpec[] = Array.from({ length: params.agents }, (_, i) => {
    const base = person(rng, i, 'agent');
    const role = i % 2 === 0 ? ('screenhost_agent' as const) : ('screencast_agent' as const);
    return {
      ...base,
      role,
      code: `SIM${role === 'screenhost_agent' ? 'SH' : 'SC'}${String(i + 1).padStart(2, '0')}`,
    };
  });

  const owners: OwnerSpec[] = Array.from({ length: params.owners }, (_, i) => ({
    ...person(rng, i, 'owner'),
    role: 'individual_owner' as const,
    acceptanceRate: Math.round(rng.float(0.55, 0.95) * 100) / 100,
    responseDelayHours: rng.int(1, 36),
  }));

  const advertisers: AdvertiserSpec[] = Array.from({ length: params.advertisers }, (_, i) => ({
    ...person(rng, i, 'adv'),
    walletTnd: rng.int(params.walletMinTnd, params.walletMaxTnd),
    rechargeReference: `SIM-${params.seed}-${String(i + 1).padStart(3, '0')}`,
  }));

  // Venue → owner: one each first, the remainder to owners who still have room (max 4 venues), so
  // a world always carries a few real fleet_owners without starving anyone.
  const venueCount = params.venues;
  const ownerLoad = owners.map(() => 0);
  const ownerOf: number[] = [];
  for (let v = 0; v < venueCount; v += 1) {
    let index = v < owners.length ? v : -1;
    if (index === -1) {
      const room = owners.map((_, i) => i).filter((i) => ownerLoad[i]! < 4);
      index = room.length > 0 ? rng.pick(room) : rng.int(0, owners.length - 1);
    }
    ownerLoad[index] = (ownerLoad[index] ?? 0) + 1;
    ownerOf.push(index);
  }
  owners.forEach((owner, i) => {
    owner.role = (ownerLoad[i] ?? 0) > 1 ? 'fleet_owner' : 'individual_owner';
  });

  const venues: VenueSpec[] = Array.from({ length: venueCount }, (_, i) => {
    const sector = rng.weighted(OWNER_SECTORS.map((s) => ({ value: s, weight: s.weight })));
    const klass = rng.weighted(VENUE_CLASSES.map((c) => ({ value: c, weight: c.weight })));
    const demographics = CLASS_DEMOGRAPHICS[klass.value];
    const male = Math.round(demographics.male + rng.float(-6, 6));
    const a1730 = Math.round(demographics.a1730 + rng.float(-5, 5));
    const a3145 = Math.round(demographics.a3145 + rng.float(-5, 5));
    const screenCount = klass.value === 'premium' ? rng.int(2, 3) : rng.int(1, 2);
    const prefix = rng.pick(VENUE_PREFIX[sector.name] ?? ['Espace']);
    const ownerIndex = ownerOf[i]!;
    return {
      id: rng.uuid(),
      name: `${prefix} ${rng.pick(VENUE_WORD)}${i >= VENUE_WORD.length ? ` ${i + 1}` : ''}`,
      sector: sector.name,
      venueClass: klass.value,
      ownerId: owners[ownerIndex]!.id,
      openingHour: sector.openingHour,
      closingHour: sector.closingHour,
      // Prod's value on every venue with hours set — the pool refuses a null capacity.
      broadcastCapacity: 4,
      sps: Math.round(rng.float(35, 85) * 100) / 100,
      latitude: Math.round((36.8065 + rng.float(-0.08, 0.08)) * 1e6) / 1e6,
      longitude: Math.round((10.1815 + rng.float(-0.08, 0.08)) * 1e6) / 1e6,
      address: `${rng.int(1, 180)} ${rng.pick(STREETS)}, Tunis`,
      screens: Array.from({ length: screenCount }, (_, s) => ({
        id: rng.uuid(),
        name: `Écran ${s + 1}`,
        offlineProbability: Math.round(rng.float(0, 0.08) * 1000) / 1000,
      })),
      demographics: {
        genderMalePct: male,
        genderFemalePct: 100 - male,
        age17To30Pct: a1730,
        age31To45Pct: a3145,
        age46PlusPct: 100 - a1730 - a3145,
      },
      grid: venueGrid(rng, sector.curve, rng.float(...klass.scale)),
    };
  });

  // Referrals: the screenhost agent takes about half the owners, the screencast agent about half
  // the advertisers — the 3 % rails then have something to pay in SIM-2's reconciliation.
  const shAgent = agents.find((a) => a.role === 'screenhost_agent');
  const scAgent = agents.find((a) => a.role === 'screencast_agent');
  const referrals: ReferralSpec[] = [];
  if (shAgent) {
    for (const owner of owners) {
      if (rng.bool(0.5)) {
        referrals.push({ agentId: shAgent.id, agentCode: shAgent.code, referredId: owner.id });
      }
    }
  }
  if (scAgent) {
    for (const advertiser of advertisers) {
      if (rng.bool(0.5)) {
        referrals.push({ agentId: scAgent.id, agentCode: scAgent.code, referredId: advertiser.id });
      }
    }
  }

  return { seed: params.seed, params, owners, advertisers, agents, venues, referrals };
};

export interface HistoryCell {
  date: string;
  hour: number;
  value: number;
}

/**
 * The venue's MEASURED past: one cell per open hour of each of the `historyDays` Tunis days
 * STRICTLY BEFORE the virtual day (the virtual day itself belongs to SIM-2's PAX). Derived from
 * the venue's own grid with a day factor and an hour jitter, on a sub-stream seeded by the venue
 * id — so history is deterministic and independent of the order venues are processed in.
 */
export const historyCells = (spec: WorldSpec, venue: VenueSpec): HistoryCell[] => {
  const rng = createRng(`${spec.seed}:${venue.id}:history`);
  const hours = broadcastableHours(venue.openingHour, venue.closingHour);
  const cells: HistoryCell[] = [];
  for (let back = spec.params.historyDays; back >= 1; back -= 1) {
    const date = addIsoDays(spec.params.virtualToday, -back);
    const dowIndex = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
    const dayFactor = rng.float(0.7, 1.3);
    for (const hour of hours) {
      const base = venue.grid[dowIndex]?.[hour] ?? 0;
      cells.push({
        date,
        hour,
        value: Math.max(0, Math.round(base * dayFactor * rng.float(0.85, 1.15))),
      });
    }
  }
  return cells;
};
