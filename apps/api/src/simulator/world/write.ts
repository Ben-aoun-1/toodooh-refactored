import { and, eq } from 'drizzle-orm';

import { db, mainDb } from '../../db/client.js';
import {
  agentReferrals,
  agents,
  businessSectors,
  governorates,
  recharges,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhosts,
  screens,
  simulationActors,
  simulations,
  users,
  zones,
} from '../../db/schema.js';
import { broadcastableHours } from '../../lib/opening-hours.js';

import { type WorldSpec, historyCells } from './spec.js';

// SIM-1 — the writer. Turns a pure WorldSpec into rows INSIDE the sandbox (the routed `db`, one
// transaction) and the actor behaviours into rows in MAIN (the explicit `mainDb`). Reference data
// (zone, sectors, governorate) is looked up BY NAME in the sandbox: ids differ per database, names
// do not — the migrations seed the same names everywhere.

/** Postgres caps a statement's bind parameters; 500 rows × ≤ 10 columns stays far below it. */
const CHUNK = 500;

const chunked = <T>(rows: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
};

export interface WorldCounts {
  venues: number;
  screens: number;
  owners: number;
  advertisers: number;
  agents: number;
  affluence_cells: number;
  history_cells: number;
  history_days: number;
}

export const writeWorld = async (
  spec: WorldSpec,
  ctx: { simulationId: string },
): Promise<WorldCounts> => {
  const counts = await db.transaction(async (tx) => {
    // ── reference data, by name ──────────────────────────────────────────────
    const [zone] = await tx.select({ id: zones.id }).from(zones).limit(1);
    if (!zone) throw new Error('sandbox has no zone row — migrations did not seed zones');

    const sectorRows = await tx
      .select({ id: businessSectors.id, name: businessSectors.name })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'));
    const sectorByName = new Map(sectorRows.map((r) => [r.name, r.id]));
    for (const venue of spec.venues) {
      if (!sectorByName.has(venue.sector)) {
        throw new Error(`sandbox has no owner business_sector named « ${venue.sector} »`);
      }
    }
    const [advertiserSector] = await tx
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'advertiser'))
      .limit(1);
    const [tunis] = await tx
      .select({ id: governorates.id })
      .from(governorates)
      .where(eq(governorates.name, 'Tunis'))
      .limit(1);

    // ── people ───────────────────────────────────────────────────────────────
    const now = new Date();
    const ownerSectorOf = new Map<string, string>();
    for (const venue of spec.venues) {
      if (!ownerSectorOf.has(venue.ownerId)) {
        ownerSectorOf.set(venue.ownerId, sectorByName.get(venue.sector)!);
      }
    }
    const referralCodeOf = new Map(spec.referrals.map((r) => [r.referredId, r.agentCode]));
    const personRow = (
      p: { id: string; email: string; contactName: string; businessName: string },
      role: (typeof users.$inferInsert)['role'],
      sectorId: string | null,
    ) => ({
      id: p.id,
      email: p.email,
      contactName: p.contactName,
      businessName: p.businessName,
      role,
      status: 'approved' as const,
      emailVerified: true,
      onboardingCompleted: true,
      termsAcceptedAt: now,
      businessSectorId: sectorId,
      governorateId: tunis?.id ?? null,
      city: 'Tunis',
      agentCode: referralCodeOf.get(p.id) ?? null,
    });

    const userRows = [
      ...spec.owners.map((o) => personRow(o, o.role, ownerSectorOf.get(o.id) ?? null)),
      ...spec.advertisers.map((a) => personRow(a, 'advertiser', advertiserSector?.id ?? null)),
      ...spec.agents.map((a) => personRow(a, a.role, null)),
    ];
    for (const rows of chunked(userRows)) await tx.insert(users).values(rows);

    if (spec.agents.length > 0) {
      await tx
        .insert(agents)
        .values(
          spec.agents.map((a) => ({
            userId: a.id,
            code: a.code,
            exportStatus: 'exported' as const,
          })),
        );
    }
    if (spec.referrals.length > 0) {
      await tx.insert(agentReferrals).values(
        spec.referrals.map((r) => ({
          agentUserId: r.agentId,
          referredUserId: r.referredId,
          agentCodeUsed: r.agentCode,
        })),
      );
    }

    // ── venues + screens ─────────────────────────────────────────────────────
    const venueRows = spec.venues.map((v) => ({
      id: v.id,
      name: v.name,
      ownerId: v.ownerId,
      businessSectorId: sectorByName.get(v.sector)!,
      zoneId: zone.id,
      governorateId: tunis?.id ?? null,
      class: v.venueClass,
      openingHour: v.openingHour,
      closingHour: v.closingHour,
      broadcastCapacity: v.broadcastCapacity,
      sps: v.sps.toFixed(2),
      latitude: v.latitude.toFixed(8),
      longitude: v.longitude.toFixed(8),
      address: v.address,
      city: 'Tunis',
      screenCount: v.screens.length,
      isActive: true,
      exportStatus: 'exported' as const,
      genderMalePct: v.demographics.genderMalePct.toFixed(2),
      genderFemalePct: v.demographics.genderFemalePct.toFixed(2),
      age17To30Pct: v.demographics.age17To30Pct.toFixed(2),
      age31To45Pct: v.demographics.age31To45Pct.toFixed(2),
      age46PlusPct: v.demographics.age46PlusPct.toFixed(2),
    }));
    for (const rows of chunked(venueRows)) await tx.insert(screenhosts).values(rows);

    // Paired and seen at the simulation's clock: the redispatch dead-screen check reads
    // max(lastSeenAt) with a 12-minute tolerance, so a world starts with every screen alive.
    const clock = new Date(`${spec.params.virtualToday}T12:00:00Z`);
    const screenRows = spec.venues.flatMap((v) =>
      v.screens.map((s) => ({
        id: s.id,
        screenhostId: v.id,
        name: s.name,
        isActive: true,
        pairedAt: clock,
        lastSeenAt: clock,
      })),
    );
    for (const rows of chunked(screenRows)) await tx.insert(screens).values(rows);

    // ── the typical week (backup grid): 7 × 48 rows per venue, both halves of an hour EQUAL ──
    const gridRows = spec.venues.flatMap((v) =>
      v.grid.flatMap((day, dowIndex) =>
        day.flatMap((value, hour) =>
          [hour * 2, hour * 2 + 1].map((slot) => ({
            screenhostId: v.id,
            dayOfWeek: dowIndex + 1,
            hour,
            slot,
            estimatedImpressions: value,
            source: 'backup' as const,
          })),
        ),
      ),
    );
    for (const rows of chunked(gridRows)) await tx.insert(screenhostAffluence).values(rows);

    // ── the measured past ────────────────────────────────────────────────────
    let historyCount = 0;
    for (const venue of spec.venues) {
      const cells = historyCells(spec, venue);
      const rows = cells.flatMap((c) =>
        [c.hour * 2, c.hour * 2 + 1].map((slot) => ({
          screenhostId: venue.id,
          date: c.date,
          hour: c.hour,
          slot,
          value: c.value,
          deviceOnline: true,
        })),
      );
      historyCount += rows.length;
      for (const batch of chunked(rows)) await tx.insert(screenhostAffluenceHourly).values(batch);
    }

    // ── wallets: one CONFIRMED recharge per advertiser (walletBalance sums exactly these) ──
    if (spec.advertisers.length > 0) {
      await tx.insert(recharges).values(
        spec.advertisers.map((a) => ({
          advertiserId: a.id,
          amountTnd: a.walletTnd.toFixed(2),
          status: 'confirmed' as const,
          reference: a.rechargeReference,
          confirmedAt: clock,
          method: 'virement' as const,
        })),
      );
    }

    return {
      venues: spec.venues.length,
      screens: screenRows.length,
      owners: spec.owners.length,
      advertisers: spec.advertisers.length,
      agents: spec.agents.length,
      affluence_cells: gridRows.length,
      history_cells: historyCount,
      history_days: spec.params.historyDays,
    } satisfies WorldCounts;
  });

  // ── MAIN: the behaviours + the world card. `mainDb` on purpose — the handler is still inside
  // the sandbox context, and this metadata must never land in a prod-shaped sandbox table.
  const actorRows = [
    ...spec.owners.map((o) => ({
      simulationId: ctx.simulationId,
      kind: 'owner' as const,
      entityId: o.id,
      params: { acceptance_rate: o.acceptanceRate, response_delay_hours: o.responseDelayHours },
    })),
    ...spec.venues.flatMap((v) =>
      v.screens.map((s) => ({
        simulationId: ctx.simulationId,
        kind: 'screen' as const,
        entityId: s.id,
        params: { offline_probability: s.offlineProbability, screenhost_id: v.id },
      })),
    ),
    ...spec.advertisers.map((a) => ({
      simulationId: ctx.simulationId,
      kind: 'advertiser' as const,
      entityId: a.id,
      params: {},
    })),
  ];
  for (const rows of chunked(actorRows)) await mainDb.insert(simulationActors).values(rows);

  await mainDb
    .update(simulations)
    .set({
      world: {
        seed: spec.seed,
        params: spec.params,
        counts,
        generated_at: new Date().toISOString(),
      },
    })
    .where(eq(simulations.id, ctx.simulationId));

  return counts;
};

/** Is this sandbox still empty? The generator refuses to run twice (one world per simulation). */
export const sandboxIsEmpty = async (): Promise<boolean> => {
  const [venue] = await db.select({ id: screenhosts.id }).from(screenhosts).limit(1);
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  return !venue && !user;
};

/** Behaviours for one simulation, keyed by the sandbox entity id (SIM-2 and the venues list). */
export const actorParams = async (
  simulationId: string,
  kind: 'owner' | 'screen' | 'advertiser',
): Promise<Map<string, Record<string, unknown>>> => {
  const rows = await mainDb
    .select({ entityId: simulationActors.entityId, params: simulationActors.params })
    .from(simulationActors)
    .where(and(eq(simulationActors.simulationId, simulationId), eq(simulationActors.kind, kind)));
  return new Map(rows.map((r) => [r.entityId, (r.params ?? {}) as Record<string, unknown>]));
};

/** Open hours of a venue, for callers that have the pair but not the helper. */
export const venueOpenHours = broadcastableHours;
