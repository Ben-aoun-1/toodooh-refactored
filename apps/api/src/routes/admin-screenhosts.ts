import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { screenhosts, screens, users } from '../db/schema.js';
import { REDISPATCH_HEARTBEAT_TOLERANCE_MS } from '../lib/dispatch/redispatch.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// ADM-SCR1 — the admin « Localités et écrans » listing (the /admin-screens page), read from the
// new-engine tables (screenhosts + screens + the owner users row). This REPLACES the Supabase-era
// admin-screens.service (locations / screens / business_profiles), which throws in prod where
// VITE_SUPABASE_* is unset. Read-only; no migration.
//
// The venue STATUS is DERIVED — there is no stored status column on screenhosts. The vocabulary is
// what the new model can honestly say (the legacy maintenance/unavailable states have no source):
//   no_screens      — the venue has no screens row at all
//   never_installed — it has screens ROWS but not one of them was ever a real device
//   active          — screenhosts.is_active AND at least one screens.is_active
//   inactive        — everything else (venue toggled off, or every screen inactive)
// It is computed IN SQL (a CASE over a per-venue screens aggregate) so the status FILTER applies
// before pagination and `total` stays exact — the legacy service filtered the page in memory and
// reported the unfiltered count.
//
// ADM-FIX1 — a screens ROW is a declaration, not an installation: the admin creates it, and
// `screens.is_active` defaults to true and is written by NO code, so a venue whose device never
// existed still read « Active ». INSTALLED is the operator ruling — `paired_at IS NOT NULL OR
// last_seen_at IS NOT NULL`, i.e. either proof that a real device once ran. Declared-but-never-
// installed venues get their own value instead of borrowing « Active ». DISPLAY-ONLY: no row is
// created, deleted or migrated, and dispatch/pricing never read these columns.
//
// SCR-DECL1 — the owner's DECLARATION rides along: declared_screens_count (= screenhosts.screen_count,
// what « X déclarés · Y installés » reads) and room_count (NULL = never declared). screens_count
// keeps meaning ROWS. The declaration is edited by PATCH /api/admin/screenhosts/:id/declaration.
//
// `connected` / online_screens_count use THE ONE liveness truth (E6's heartbeat tolerance on
// last_seen_at — the same predicate as /api/admin/screenhosts/:id/devices and the owner reads).
// Revenue is NOT served: the legacy monthly_revenue column has no new-engine twin, and a payout
// aggregate is money-adjacent (which month, gross/net) — a product ruling, not a listing default.
const LOCATION_STATUSES = ['active', 'inactive', 'never_installed', 'no_screens'] as const;
export type AdminLocationStatus = (typeof LOCATION_STATUSES)[number];

const listQuerySchema = z.object({
  status: z.enum(LOCATION_STATUSES).optional(),
  owner_id: z.uuid().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

// LIKE metacharacters in a free-text search must match literally (a `%` typed by the admin is a
// character, not a wildcard). Postgres' default LIKE escape is backslash.
const escapeLike = (term: string): string => term.replace(/[\\%_]/g, '\\$&');

// Per-screen wire. The old `status` (screens.is_active, never written → 'active' forever) is GONE:
// the web reads the connected / offline / never vocabulary off `connected` + `last_seen_at`, and
// `installed` carries the ruling's predicate so a paired-but-silent device is told apart from a
// row that no device ever answered.
const toScreenView = (
  row: {
    id: string;
    name: string;
    lastSeenAt: Date | null;
    pairedAt: Date | null;
  },
  now: number,
) => ({
  id: row.id,
  name: row.name,
  installed: row.pairedAt !== null || row.lastSeenAt !== null,
  connected:
    row.lastSeenAt !== null && now - row.lastSeenAt.getTime() <= REDISPATCH_HEARTBEAT_TOLERANCE_MS,
  last_seen_at: row.lastSeenAt,
  paired_at: row.pairedAt,
});

export const adminScreenhostsRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/screenhosts?status&owner_id&search&page&per_page — paginated venue list with the
  // per-venue screens folded in. `total` honors every filter (status included).
  app.get('/api/admin/screenhosts', adminGuard, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { status, owner_id, page, per_page } = parsed.data;
    const search = parsed.data.search ? parsed.data.search : undefined;

    const now = Date.now();
    const heartbeatCutoff = new Date(now - REDISPATCH_HEARTBEAT_TOLERANCE_MS);

    // Per-venue screens aggregate — one GROUP BY, LEFT JOINed so a venue with no screens still
    // lists (with zeros → 'no_screens').
    const agg = db
      .select({
        screenhostId: screens.screenhostId,
        screensCount: count().as('screens_count'),
        activeCount: sql<number>`count(*) filter (where ${screens.isActive})`
          .mapWith(Number)
          .as('active_count'),
        // INSTALLED — either proof that a real device once ran against this row (operator ruling).
        installedCount:
          sql<number>`count(*) filter (where ${screens.pairedAt} is not null or ${screens.lastSeenAt} is not null)`
            .mapWith(Number)
            .as('installed_count'),
        onlineCount:
          sql<number>`count(*) filter (where ${gte(screens.lastSeenAt, heartbeatCutoff)})`
            .mapWith(Number)
            .as('online_count'),
      })
      .from(screens)
      .groupBy(screens.screenhostId)
      .as('agg');

    const screensCount = sql<number>`coalesce(${agg.screensCount}, 0)`.mapWith(Number);
    const activeCount = sql<number>`coalesce(${agg.activeCount}, 0)`.mapWith(Number);
    const installedCount = sql<number>`coalesce(${agg.installedCount}, 0)`.mapWith(Number);
    const onlineCount = sql<number>`coalesce(${agg.onlineCount}, 0)`.mapWith(Number);
    const statusExpr = sql<AdminLocationStatus>`case
      when ${screensCount} = 0 then 'no_screens'
      when ${installedCount} = 0 then 'never_installed'
      when ${screenhosts.isActive} and ${activeCount} > 0 then 'active'
      else 'inactive'
    end`;

    const conditions = [];
    if (owner_id) conditions.push(eq(screenhosts.ownerId, owner_id));
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(
        or(
          ilike(screenhosts.name, pattern),
          ilike(screenhosts.address, pattern),
          ilike(screenhosts.city, pattern),
        ),
      );
    }
    if (status) conditions.push(sql`${statusExpr} = ${status}`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [[totalRow], rows] = await Promise.all([
      db
        .select({ c: count() })
        .from(screenhosts)
        .leftJoin(agg, eq(agg.screenhostId, screenhosts.id))
        .where(where),
      db
        .select({
          id: screenhosts.id,
          name: screenhosts.name,
          address: screenhosts.address,
          city: screenhosts.city,
          ownerId: screenhosts.ownerId,
          ownerBusinessName: users.businessName,
          ownerContactName: users.contactName,
          createdAt: screenhosts.createdAt,
          declaredScreensCount: screenhosts.screenCount,
          roomCount: screenhosts.roomCount,
          status: statusExpr,
          screensCount,
          activeCount,
          installedCount,
          onlineCount,
        })
        .from(screenhosts)
        .leftJoin(agg, eq(agg.screenhostId, screenhosts.id))
        .leftJoin(users, eq(users.id, screenhosts.ownerId))
        .where(where)
        .orderBy(desc(screenhosts.createdAt), asc(screenhosts.name))
        .limit(per_page)
        .offset((page - 1) * per_page),
    ]);

    const ids = rows.map((r) => r.id);
    const screenRows =
      ids.length > 0
        ? await db
            .select({
              id: screens.id,
              screenhostId: screens.screenhostId,
              name: screens.name,
              lastSeenAt: screens.lastSeenAt,
              pairedAt: screens.pairedAt,
            })
            .from(screens)
            .where(inArray(screens.screenhostId, ids))
            .orderBy(asc(screens.name))
        : [];
    const screensByVenue = new Map<string, ReturnType<typeof toScreenView>[]>();
    for (const s of screenRows) {
      const list = screensByVenue.get(s.screenhostId) ?? [];
      list.push(toScreenView(s, now));
      screensByVenue.set(s.screenhostId, list);
    }

    return reply.status(200).send({
      locations: rows.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        city: r.city,
        status: r.status,
        owner_id: r.ownerId,
        owner_business_name: r.ownerBusinessName ?? r.ownerContactName ?? null,
        declared_screens_count: r.declaredScreensCount,
        room_count: r.roomCount,
        screens_count: r.screensCount,
        active_screens_count: r.activeCount,
        installed_screens_count: r.installedCount,
        online_screens_count: r.onlineCount,
        created_at: r.createdAt,
        screens: screensByVenue.get(r.id) ?? [],
      })),
      total: totalRow?.c ?? 0,
      page,
      per_page,
    });
  });

  // GET /api/admin/screenhosts/owners — the owner picker: every user holding ≥1 venue, once.
  // Static path — cannot collide with the deeper /api/admin/screenhosts/:id/* param routes.
  app.get('/api/admin/screenhosts/owners', adminGuard, async (_request, reply) => {
    // The display name is the business name, the contact name standing in when it is null. It is
    // selected AND ordered by as the same expression (SELECT DISTINCT requires that).
    const displayName = sql<string>`coalesce(${users.businessName}, ${users.contactName})`;
    const rows = await db
      .selectDistinct({ id: users.id, businessName: displayName })
      .from(screenhosts)
      .innerJoin(users, eq(users.id, screenhosts.ownerId))
      .orderBy(asc(displayName), asc(users.id));
    return reply.status(200).send({
      owners: rows.map((r) => ({ id: r.id, business_name: r.businessName })),
    });
  });
};
