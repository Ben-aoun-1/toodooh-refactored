import { hashPassword } from 'better-auth/crypto';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  accounts,
  businessSectors,
  campaigns,
  demoScreenhosts,
  dispatchConfig,
  screenhosts,
  sessions,
  users,
  walletAdjustments,
} from '../db/schema.js';
import {
  createDemoScreenhost,
  listDemoScreenhosts,
  removeDemoScreenhost,
} from '../lib/demo-screenhosts.js';
import { DEMO_DELAY_MAX_MINUTES, demoDelayMinutes, realVenueSql } from '../lib/demo.js';
import { pushPlaylistToCampaignVenues } from '../lib/playout/push.js';
import { MAX_RECHARGE_TND, walletSpendable } from '../lib/recharges.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// DEMO-1 (operator 2026-10-12, rulings A A A A A A — lib/demo.ts) — the admin « Démo » page's API:
// the delay (minutes) between a demo confirm and the TV, the REAL venues opened to demos, and the
// demo screencasters (created approved with a pre-filled profile + a « Crédit démo » balance,
// topped up, deleted). Deleting stops the account's campaigns on the TVs first (Q6 A), then bans
// it (sessions revoked) — the rows stay, so nothing that references them breaks.

const DEMO_CREDIT_REASON = 'Crédit démo';
const STOP_REASON = 'Compte démo supprimé';

const idParamSchema = z.object({ id: z.uuid() });
const configSchema = z.object({
  delay_minutes: z.number().int().min(0).max(DEMO_DELAY_MAX_MINUTES),
});
const venuesSchema = z.object({ screenhost_ids: z.array(z.uuid()).max(500) });
const amountSchema = z.number().positive().max(MAX_RECHARGE_TND).multipleOf(0.01);
const createSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  business_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().min(1).max(200).optional(),
  balance_tnd: amountSchema,
});
const creditSchema = z.object({ amount_tnd: amountSchema });
const hourSchema = z.number().int().min(0).max(23);
const demoScreenhostSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    city: z.string().trim().min(1).max(200).nullable().optional(),
    business_sector_id: z.uuid().nullable().optional(),
    class: z.enum(['populaire', 'moyen', 'premium']).nullable().optional(),
    opening_hour: hourSchema,
    closing_hour: hourSchema,
    audience_min: z.number().int().min(0).max(100_000),
    audience_max: z.number().int().min(1).max(100_000),
  })
  .refine((v) => v.opening_hour !== v.closing_hour, {
    path: ['closing_hour'],
    message: 'opening and closing hours must differ',
  })
  .refine((v) => v.audience_min <= v.audience_max, {
    path: ['audience_max'],
    message: 'audience_max must be ≥ audience_min',
  });

/** The profile every demo account is born with (Q5 A — the admin types the rest). */
const DEMO_PROFILE = {
  contactPhone: '+21670000000',
  fonction: 'Responsable marketing',
  businessType: 'entreprise',
  streetAddress: 'Avenue Habib Bourguiba',
  city: 'Tunis',
  postalCode: '1000',
} as const;

const invalid = (reply: FastifyReply, issues: z.core.$ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

/** The live demo accounts (a deleted one is banned and drops out). */
const loadAccounts = async () => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      businessName: users.businessName,
      contactName: users.contactName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.isDemo, true), ne(users.status, 'banned')))
    .orderBy(desc(users.createdAt));
  const ids = rows.map((r) => r.id);
  const campaignRows = ids.length
    ? await db
        .select({
          id: campaigns.id,
          advertiserId: campaigns.advertiserId,
          name: campaigns.name,
          status: campaigns.status,
          startDate: campaigns.startDate,
          endDate: campaigns.endDate,
          airsAt: campaigns.airsAt,
          airsPushedAt: campaigns.airsPushedAt,
        })
        .from(campaigns)
        .where(and(inArray(campaigns.advertiserId, ids), ne(campaigns.status, 'draft')))
        .orderBy(desc(campaigns.createdAt))
    : [];
  return Promise.all(
    rows.map(async (r) => {
      const wallet = await walletSpendable(r.id);
      return {
        id: r.id,
        email: r.email,
        business_name: r.businessName,
        contact_name: r.contactName,
        created_at: r.createdAt.toISOString(),
        balance_tnd: wallet.balance_tnd,
        spendable_tnd: wallet.spendable_tnd,
        campaigns: campaignRows
          .filter((c) => c.advertiserId === r.id)
          .map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            start_date: c.startDate,
            end_date: c.endDate,
            airs_at: c.airsAt?.toISOString() ?? null,
            on_air_pushed_at: c.airsPushedAt?.toISOString() ?? null,
          })),
      };
    }),
  );
};

const loadVenues = async () => {
  const demo = new Set(
    (await db.select({ id: demoScreenhosts.screenhostId }).from(demoScreenhosts)).map((r) => r.id),
  );
  const rows = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      ownerName: sql<string | null>`coalesce(${users.businessName}, ${users.contactName})`,
    })
    .from(screenhosts)
    .leftJoin(users, eq(screenhosts.ownerId, users.id))
    // DEMO-2 — the picker lists REAL venues; demo screenhosts are always open to demos.
    .where(and(eq(screenhosts.isActive, true), realVenueSql()))
    .orderBy(asc(screenhosts.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    owner_name: r.ownerName,
    is_demo_venue: demo.has(r.id),
  }));
};

const findDemoAccount = async (id: string) => {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.isDemo, true), ne(users.status, 'banned')))
    .limit(1);
  return row;
};

export const adminDemoRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/demo — the whole page: delay, venues (demo ones flagged), accounts.
  app.get('/api/admin/demo', adminGuard, async (_request, reply) =>
    reply.status(200).send({
      delay_minutes: await demoDelayMinutes(),
      venues: await loadVenues(),
      demo_screenhosts: await listDemoScreenhosts(),
      // The venue sectors a demo screenhost may take (owner-audience, by display order).
      sectors: await db
        .select({ id: businessSectors.id, name: businessSectors.name })
        .from(businessSectors)
        .where(eq(businessSectors.audience, 'owner'))
        .orderBy(asc(businessSectors.displayOrder), asc(businessSectors.name)),
      accounts: await loadAccounts(),
    }),
  );

  // POST /api/admin/demo/screenhosts — a demo screenhost (DEMO-2): a map point with a random
  // typical-week audience, for demo screencasters only.
  app.post('/api/admin/demo/screenhosts', adminGuard, async (request, reply) => {
    const parsed = demoScreenhostSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const v = parsed.data;
    const sectorId = v.business_sector_id ?? null;
    if (sectorId) {
      const [sector] = await db
        .select({ id: businessSectors.id })
        .from(businessSectors)
        .where(and(eq(businessSectors.id, sectorId), eq(businessSectors.audience, 'owner')));
      if (!sector) {
        return reply.status(400).send({ error: 'UNKNOWN_SECTOR', message: 'Unknown sector id.' });
      }
    }
    const id = await createDemoScreenhost({
      name: v.name,
      latitude: v.latitude,
      longitude: v.longitude,
      city: v.city ?? null,
      businessSectorId: sectorId,
      class: v.class ?? null,
      openingHour: v.opening_hour,
      closingHour: v.closing_hour,
      audienceMin: v.audience_min,
      audienceMax: v.audience_max,
    });
    const created = (await listDemoScreenhosts()).find((s) => s.id === id);
    return reply.status(201).send(created);
  });

  // DELETE /api/admin/demo/screenhosts/:id — deactivates it (campaigns already placed keep it).
  app.delete('/api/admin/demo/screenhosts/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    if (!(await removeDemoScreenhost(params.data.id))) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such demo screenhost.' });
    }
    return reply.status(200).send({ deleted: params.data.id });
  });

  // PATCH /api/admin/demo/config {delay_minutes} — minutes from a demo confirm to the TV.
  app.patch('/api/admin/demo/config', adminGuard, async (request, reply) => {
    const parsed = configSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    await db.update(dispatchConfig).set({ demoDelayMinutes: parsed.data.delay_minutes });
    return reply.status(200).send({ delay_minutes: await demoDelayMinutes() });
  });

  // PUT /api/admin/demo/venues {screenhost_ids} — REPLACES the set of demo venues. Campaigns
  // already dispatched keep their venues; the set bounds the next dispatches.
  app.put('/api/admin/demo/venues', adminGuard, async (request, reply) => {
    const parsed = venuesSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const ids = [...new Set(parsed.data.screenhost_ids)];
    if (ids.length > 0) {
      const known = await db
        .select({ id: screenhosts.id })
        .from(screenhosts)
        .where(inArray(screenhosts.id, ids));
      if (known.length !== ids.length) {
        return reply.status(400).send({ error: 'UNKNOWN_VENUE', message: 'Unknown venue id.' });
      }
    }
    const adminId = request.user?.id ?? null;
    await db.transaction(async (tx) => {
      await tx.delete(demoScreenhosts);
      if (ids.length > 0) {
        await tx
          .insert(demoScreenhosts)
          .values(ids.map((screenhostId) => ({ screenhostId, addedBy: adminId })));
      }
    });
    return reply.status(200).send({ venues: await loadVenues() });
  });

  // POST /api/admin/demo/accounts — an approved demo screencaster with its starting balance.
  app.post('/api/admin/demo/accounts', adminGuard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { password, business_name, contact_name, balance_tnd } = parsed.data;
    const email = parsed.data.email.toLowerCase();
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) {
      return reply.status(409).send({
        error: 'EMAIL_TAKEN',
        message: 'An account with this email already exists.',
        fields: [{ field: 'email', reason: 'already registered' }],
      });
    }
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const id = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          contactName: contact_name ?? business_name,
          businessName: business_name,
          ...DEMO_PROFILE,
          emailVerified: true,
          role: 'advertiser',
          status: 'approved',
          validatedBy: adminId,
          validatedAt: now,
          onboardingCompleted: true,
          termsAcceptedAt: now,
          isDemo: true,
        })
        .returning({ id: users.id });
      if (!user) throw new Error('demo account insert returned no row');
      await tx.insert(accounts).values({
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: passwordHash,
      });
      await tx.insert(walletAdjustments).values({
        advertiserId: user.id,
        adminId,
        amountTnd: balance_tnd.toFixed(2),
        reason: DEMO_CREDIT_REASON,
      });
      return user.id;
    });
    const account = (await loadAccounts()).find((a) => a.id === id);
    return reply.status(201).send(account);
  });

  // POST /api/admin/demo/accounts/:id/credit {amount_tnd} — tops the demo balance up.
  app.post('/api/admin/demo/accounts/:id/credit', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const parsed = creditSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    if (!(await findDemoAccount(params.data.id))) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such demo account.' });
    }
    await db.insert(walletAdjustments).values({
      advertiserId: params.data.id,
      adminId,
      amountTnd: parsed.data.amount_tnd.toFixed(2),
      reason: DEMO_CREDIT_REASON,
    });
    const account = (await loadAccounts()).find((a) => a.id === params.data.id);
    return reply.status(200).send(account);
  });

  // DELETE /api/admin/demo/accounts/:id — stops its campaigns on the TVs, then bans it.
  app.delete('/api/admin/demo/accounts/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const id = params.data.id;
    if (!(await findDemoAccount(id))) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such demo account.' });
    }
    const stopped = await db
      .update(campaigns)
      .set({ status: 'rejected', rejectedAt: new Date(), rejectReason: STOP_REASON })
      .where(
        and(
          eq(campaigns.advertiserId, id),
          inArray(campaigns.status, ['draft', 'pending', 'upcoming', 'active']),
        ),
      )
      .returning({ id: campaigns.id });
    await db
      .update(users)
      .set({ status: 'banned', validationNotes: STOP_REASON })
      .where(eq(users.id, id));
    await db.delete(sessions).where(eq(sessions.userId, id));
    // The stopped campaigns leave the TVs now, not at the screens' next reconnect.
    for (const c of stopped) await pushPlaylistToCampaignVenues(c.id, request.log);
    return reply.status(200).send({ deleted: id, campaigns_stopped: stopped.length });
  });
};
