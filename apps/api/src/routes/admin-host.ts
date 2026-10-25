import { and, asc, count, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  governorates,
  screenhosts,
  screenhostUnavailability,
  users,
} from '../db/schema.js';
import { tunisDateOf } from '../lib/campaign-dates.js';
import { listHostAudit, writeHostAudit } from '../lib/host-audit.js';
import { HOST_LOCK_KEYS, isHostLockKey } from '../lib/host-locks.js';
import { setVenueDayUnavailability } from '../lib/venue-unavailability.js';
import { pushApprovedOwnerLocations } from '../lib/wedooh-sync.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import {
  type HostOwnerPatch,
  type HostVenuePatch,
  hostOwnerPatchSchema,
  hostVenuePatchSchema,
} from '../validation/admin-host.js';
import { normalizeTaxNumber } from '../validation/tax-number.js';

// HOST-EDIT1 — the admin « Fiche Host » (2026-10-25): every parameter of a venue editable from the
// administration, without touching the database (rulings Q1 A dedicated page, Q2 B owner fields
// included, Q3 A trail, Q4 B no deactivation switch, Q5 B hub lock, Q6 A admin + superadmin).
//
// This file holds what had no route: the venue's identity and location, its owner's account, the
// hub locks, the trail and the admin twin of the unavailability calendar. Hours / sector / class /
// capacity, WiFi and the screen declaration keep their existing admin routes (screenhosts.ts,
// screenhost-declaration.ts), which now also lock and audit.
//
// Every change that the hub's location payload carries (lib/wedooh-sync.ts buildLocationPayload:
// venue name, address, city, postal code, zone, governorate, GPS, and the owner's business name,
// contact name and phone) re-pushes the owner's venues when the owner is approved — the admin
// WiFi-edit idiom: fire-and-forget, the 10-min sweep retries a failure.

const idParamSchema = z.object({ id: z.uuid() });
const rangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
const dayPutSchema = z.object({ day: z.iso.date(), unavailable: z.boolean() });

const invalid = (reply: FastifyReply, fields: { field: string; reason: string }[]) =>
  reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed', fields });
const issues = (error: z.ZodError) =>
  error.issues.map((i) => ({ field: i.path.join('.') || 'body', reason: i.message }));
const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });

// Drizzle numeric → number (the screenhosts.ts `num` convention).
const num = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const venueSelection = {
  id: screenhosts.id,
  name: screenhosts.name,
  address: screenhosts.address,
  city: screenhosts.city,
  postalCode: screenhosts.postalCode,
  governorateId: screenhosts.governorateId,
  zone: screenhosts.zone,
  latitude: screenhosts.latitude,
  longitude: screenhosts.longitude,
  isActive: screenhosts.isActive,
  demoOnly: screenhosts.demoOnly,
  screenCount: screenhosts.screenCount,
  roomCount: screenhosts.roomCount,
  exportStatus: screenhosts.exportStatus,
  exportedAt: screenhosts.exportedAt,
  // WiFi: the SSID, and only the PRESENCE of a password (venueView) — the cipher never leaves.
  wifiSsid: screenhosts.wifiSsid,
  wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted,
  adminLockedFields: screenhosts.adminLockedFields,
  ownerId: screenhosts.ownerId,
  createdAt: screenhosts.createdAt,
  updatedAt: screenhosts.updatedAt,
};
const selectVenue = (id: string) =>
  db.select(venueSelection).from(screenhosts).where(eq(screenhosts.id, id)).limit(1);
type VenueRow = Awaited<ReturnType<typeof selectVenue>>[number];

// The editable fields, wire-shaped — the trail's before / after snapshots.
const venueEditable = (row: VenueRow) => ({
  name: row.name,
  address: row.address,
  city: row.city,
  postal_code: row.postalCode,
  governorate_id: row.governorateId,
  zone: row.zone,
  latitude: num(row.latitude),
  longitude: num(row.longitude),
});

const venueView = (row: VenueRow) => ({
  id: row.id,
  ...venueEditable(row),
  is_active: row.isActive,
  demo_only: row.demoOnly,
  screen_count: row.screenCount,
  room_count: row.roomCount,
  wifi_ssid: row.wifiSsid,
  wifi_password_set: row.wifiPasswordEncrypted !== null,
  export_status: row.exportStatus,
  exported_at: row.exportedAt,
  locked_fields: HOST_LOCK_KEYS.filter((k) => row.adminLockedFields.includes(k)),
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const ownerSelection = {
  id: users.id,
  email: users.email,
  role: users.role,
  status: users.status,
  businessName: users.businessName,
  taxNumber: users.taxNumber,
  contactName: users.contactName,
  contactPhone: users.contactPhone,
  fonction: users.fonction,
  streetAddress: users.streetAddress,
  city: users.city,
  postalCode: users.postalCode,
  governorateId: users.governorateId,
  zone: users.zone,
};
const selectOwner = (id: string) =>
  db.select(ownerSelection).from(users).where(eq(users.id, id)).limit(1);
type OwnerRow = Awaited<ReturnType<typeof selectOwner>>[number];

const ownerEditable = (row: OwnerRow) => ({
  business_name: row.businessName,
  tax_number: row.taxNumber,
  contact_name: row.contactName,
  contact_phone: row.contactPhone,
  fonction: row.fonction,
  street_address: row.streetAddress,
  city: row.city,
  postal_code: row.postalCode,
  governorate_id: row.governorateId,
  zone: row.zone,
});

// The owner fields the hub's location payload carries — a change to one re-pushes.
const OWNER_FIELDS_ON_HUB = ['business_name', 'contact_name', 'contact_phone'] as const;

const governorateExists = async (id: string): Promise<boolean> => {
  const [row] = await db
    .select({ id: governorates.id })
    .from(governorates)
    .where(eq(governorates.id, id))
    .limit(1);
  return row !== undefined;
};

const loadVenue = async (id: string): Promise<VenueRow | undefined> => (await selectVenue(id))[0];
const loadOwner = async (id: string): Promise<OwnerRow | undefined> => (await selectOwner(id))[0];

const toVenueColumns = (data: HostVenuePatch): Partial<typeof screenhosts.$inferInsert> => {
  const patch: Partial<typeof screenhosts.$inferInsert> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.address !== undefined) patch.address = data.address;
  if (data.city !== undefined) patch.city = data.city;
  if (data.postal_code !== undefined) patch.postalCode = data.postal_code;
  if (data.governorate_id !== undefined) patch.governorateId = data.governorate_id;
  if (data.zone !== undefined) patch.zone = data.zone;
  if (data.latitude !== undefined) {
    patch.latitude = data.latitude === null ? null : data.latitude.toString();
  }
  if (data.longitude !== undefined) {
    patch.longitude = data.longitude === null ? null : data.longitude.toString();
  }
  return patch;
};

const toOwnerColumns = (data: HostOwnerPatch): Partial<typeof users.$inferInsert> => {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (data.business_name !== undefined) patch.businessName = data.business_name;
  if (data.tax_number !== undefined) {
    patch.taxNumber = data.tax_number === null ? null : normalizeTaxNumber(data.tax_number);
  }
  if (data.contact_name !== undefined) patch.contactName = data.contact_name;
  if (data.contact_phone !== undefined) patch.contactPhone = data.contact_phone;
  if (data.fonction !== undefined) patch.fonction = data.fonction === '' ? null : data.fonction;
  if (data.street_address !== undefined) patch.streetAddress = data.street_address;
  if (data.city !== undefined) patch.city = data.city;
  if (data.postal_code !== undefined) patch.postalCode = data.postal_code;
  if (data.governorate_id !== undefined) patch.governorateId = data.governorate_id;
  if (data.zone !== undefined) patch.zone = data.zone === '' ? null : data.zone;
  return patch;
};

export const adminHostRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  const repush = (
    ownerId: string | null,
    log: Parameters<typeof pushApprovedOwnerLocations>[1],
  ) => {
    if (!ownerId) return;
    void (async () => {
      const [owner] = await db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, ownerId));
      if (owner?.status === 'approved') await pushApprovedOwnerLocations(ownerId, log);
    })().catch((err: unknown) => {
      log.warn({ err }, 'wedooh re-push (admin Fiche Host edit) failed to start');
    });
  };

  // GET /api/admin/screenhosts/:id — the whole « Fiche Host »: the venue and its owner's account.
  // (The static /api/admin/screenhosts/owners route wins over this param route.)
  app.get('/api/admin/screenhosts/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, [{ field: 'id', reason: 'must be a uuid' }]);
    const venue = await loadVenue(params.data.id);
    if (!venue) return notFound(reply);
    let owner: (ReturnType<typeof ownerEditable> & Record<string, unknown>) | null = null;
    if (venue.ownerId) {
      const row = await loadOwner(venue.ownerId);
      if (row) {
        const [venues] = await db
          .select({ n: count() })
          .from(screenhosts)
          .where(eq(screenhosts.ownerId, row.id));
        owner = {
          id: row.id,
          email: row.email,
          role: row.role,
          status: row.status,
          ...ownerEditable(row),
          venues_count: venues?.n ?? 0,
        };
      }
    }
    return reply.status(200).send({ venue: venueView(venue), owner });
  });

  // PATCH /api/admin/screenhosts/:id — the venue's name, address and GPS position.
  app.patch('/api/admin/screenhosts/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, [{ field: 'id', reason: 'must be a uuid' }]);
    const body = hostVenuePatchSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, issues(body.error));
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const existing = await loadVenue(params.data.id);
    if (!existing) return notFound(reply);

    const lat = body.data.latitude !== undefined ? body.data.latitude : num(existing.latitude);
    const lng = body.data.longitude !== undefined ? body.data.longitude : num(existing.longitude);
    if ((lat === null) !== (lng === null)) {
      return invalid(reply, [
        { field: 'longitude', reason: 'latitude and longitude must be set together or both null' },
      ]);
    }
    if (body.data.governorate_id && !(await governorateExists(body.data.governorate_id))) {
      return invalid(reply, [{ field: 'governorate_id', reason: 'unknown governorate' }]);
    }

    const before = venueEditable(existing);
    const { updated, changed } = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(screenhosts)
        .set(toVenueColumns(body.data))
        .where(eq(screenhosts.id, existing.id))
        .returning(venueSelection);
      if (!row) return { updated: existing, changed: false };
      const wrote = await writeHostAudit(tx, {
        screenhostId: existing.id,
        section: 'venue',
        changedBy: adminId,
        before,
        after: venueEditable(row),
      });
      return { updated: row, changed: wrote };
    });
    // Every editable venue field rides the hub's location payload.
    if (changed) repush(existing.ownerId, request.log);
    return reply.status(200).send({ venue: venueView(updated) });
  });

  // PATCH /api/admin/screenhosts/:id/owner — the account of the venue's owner (shared by all of a
  // fleet owner's venues). The trail row is written on THIS venue, the one the admin edited from.
  app.patch('/api/admin/screenhosts/:id/owner', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, [{ field: 'id', reason: 'must be a uuid' }]);
    const body = hostOwnerPatchSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, issues(body.error));
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const venue = await loadVenue(params.data.id);
    if (!venue) return notFound(reply);
    if (!venue.ownerId) {
      return reply
        .status(409)
        .send({ error: 'NO_OWNER', message: 'This screenhost has no owner account.' });
    }
    const existing = await loadOwner(venue.ownerId);
    if (!existing) return notFound(reply);

    if (body.data.governorate_id && !(await governorateExists(body.data.governorate_id))) {
      return invalid(reply, [{ field: 'governorate_id', reason: 'unknown governorate' }]);
    }
    // tax_number is UNIQUE — a clean 409 rather than a constraint 500 (the signup pre-check).
    if (body.data.tax_number) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.taxNumber, normalizeTaxNumber(body.data.tax_number)),
            ne(users.id, existing.id),
          ),
        )
        .limit(1);
      if (taken) {
        return reply.status(409).send({
          error: 'TAX_NUMBER_TAKEN',
          message: 'Ce matricule fiscal est déjà utilisé par un autre compte.',
          fields: [{ field: 'tax_number', reason: 'already registered' }],
        });
      }
    }

    const before = ownerEditable(existing);
    const { updated, diff } = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set(toOwnerColumns(body.data))
        .where(eq(users.id, existing.id))
        .returning(ownerSelection);
      if (!row) return { updated: existing, diff: false };
      const wrote = await writeHostAudit(tx, {
        screenhostId: venue.id,
        section: 'owner',
        changedBy: adminId,
        before,
        after: ownerEditable(row),
      });
      return { updated: row, diff: wrote };
    });
    const after = ownerEditable(updated);
    if (diff && OWNER_FIELDS_ON_HUB.some((k) => before[k] !== after[k])) {
      repush(existing.id, request.log);
    }
    return reply.status(200).send({ owner: { id: updated.id, email: updated.email, ...after } });
  });

  // DELETE /api/admin/screenhosts/:id/locks/:field — « Rendre au hub »: the hub's next push may
  // write that field again. Removing a key that is not locked is a 200 no-op.
  app.delete('/api/admin/screenhosts/:id/locks/:field', adminGuard, async (request, reply) => {
    const params = z.object({ id: z.uuid(), field: z.string() }).safeParse(request.params);
    if (!params.success || !isHostLockKey(params.data.field)) {
      return invalid(reply, [
        { field: 'field', reason: `must be one of ${HOST_LOCK_KEYS.join(', ')}` },
      ]);
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const existing = await loadVenue(params.data.id);
    if (!existing) return notFound(reply);
    const field = params.data.field;
    const locks = existing.adminLockedFields.filter((k) => k !== field);
    if (locks.length !== existing.adminLockedFields.length) {
      await db.transaction(async (tx) => {
        await tx
          .update(screenhosts)
          .set({ adminLockedFields: locks })
          .where(eq(screenhosts.id, existing.id));
        await writeHostAudit(tx, {
          screenhostId: existing.id,
          section: 'lock',
          changedBy: adminId,
          before: { [field]: true },
          after: { [field]: false },
        });
      });
    }
    return reply
      .status(200)
      .send({ locked_fields: HOST_LOCK_KEYS.filter((k) => locks.includes(k)) });
  });

  // GET /api/admin/screenhosts/:id/history — the admin trail, newest first.
  app.get('/api/admin/screenhosts/:id/history', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, [{ field: 'id', reason: 'must be a uuid' }]);
    const venue = await loadVenue(params.data.id);
    if (!venue) return notFound(reply);
    return reply.status(200).send({ entries: await listHostAudit(venue.id) });
  });

  // GET /api/admin/screenhosts/:id/unavailability?from&to — the owner read's admin twin.
  app.get('/api/admin/screenhosts/:id/unavailability', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, [{ field: 'id', reason: 'must be a uuid' }]);
    const query = rangeSchema.safeParse(request.query);
    if (!query.success) return invalid(reply, issues(query.error));
    const venue = await loadVenue(params.data.id);
    if (!venue) return notFound(reply);
    const rows = await db
      .select({ day: screenhostUnavailability.day })
      .from(screenhostUnavailability)
      .where(
        and(
          eq(screenhostUnavailability.screenhostId, venue.id),
          gte(screenhostUnavailability.day, query.data.from),
          lte(screenhostUnavailability.day, query.data.to),
        ),
      )
      .orderBy(asc(screenhostUnavailability.day));
    // The days in range that carry a live share of a campaign (the shares a declaration MOVES —
    // lib/venue-unavailability.ts selects the same statuses), so the admin is warned before
    // declaring one, like the owner calendar.
    const shares = await db
      .select({ name: campaigns.name, creneaux: campaignDispatchAllocation.creneaux })
      .from(campaignDispatchAllocation)
      .innerJoin(
        campaignDispatchPlan,
        eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
      )
      .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
      .where(
        and(
          eq(campaignDispatchAllocation.screenhostId, venue.id),
          inArray(campaignDispatchAllocation.statutAcceptation, ['ACCEPTE', 'EN_ATTENTE']),
          inArray(campaigns.status, ['pending', 'upcoming', 'active']),
          lte(campaigns.startDate, query.data.to),
          gte(campaigns.endDate, query.data.from),
        ),
      );
    const diffusion: Record<string, string[]> = {};
    for (const share of shares) {
      for (const c of share.creneaux) {
        if (c.date < query.data.from || c.date > query.data.to) continue;
        const names = (diffusion[c.date] ??= []);
        if (!names.includes(share.name)) names.push(share.name);
      }
    }
    return reply.status(200).send({ days: rows.map((r) => r.day), diffusion_days: diffusion });
  });

  // PUT /api/admin/screenhosts/:id/unavailability {day, unavailable} — the owner write's admin twin:
  // the SAME future-only rule and the SAME share re-placement (lib/venue-unavailability.ts).
  app.put('/api/admin/screenhosts/:id/unavailability', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, [{ field: 'id', reason: 'must be a uuid' }]);
    const body = dayPutSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, issues(body.error));
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { day, unavailable } = body.data;
    if (day <= tunisDateOf(new Date())) {
      return reply.status(400).send({
        error: 'PAST_OR_TODAY',
        message: 'Only future days can be declared or undeclared.',
        day,
      });
    }
    const venue = await loadVenue(params.data.id);
    if (!venue) return notFound(reply);
    const [was] = await db
      .select({ day: screenhostUnavailability.day })
      .from(screenhostUnavailability)
      .where(
        and(
          eq(screenhostUnavailability.screenhostId, venue.id),
          eq(screenhostUnavailability.day, day),
        ),
      );
    const redispatched = await setVenueDayUnavailability(venue.id, day, unavailable, request.log);
    await writeHostAudit(db, {
      screenhostId: venue.id,
      section: 'unavailability',
      changedBy: adminId,
      before: { [day]: was !== undefined },
      after: { [day]: unavailable },
    });
    return reply.status(200).send({ screenhost_id: venue.id, day, unavailable, redispatched });
  });
};
