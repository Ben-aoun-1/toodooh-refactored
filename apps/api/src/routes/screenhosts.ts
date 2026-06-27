import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { screenhostAffluence, screenhosts, users } from '../db/schema.js';
import { pushApprovedOwnerLocations } from '../lib/wedooh-sync.js';
import { decryptWifiPassword, encryptWifiPassword } from '../lib/wifi-crypto.js';
import { requireActiveAccount, requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Owner- and admin-facing WiFi maintenance for screenhosts. A venue's WiFi can change after
// signup (Kais 2026-06), so SSID + password are editable here by the owner (their own
// screenhosts) and by an admin (any screenhost). The password stays write-only on the LIST + EDIT
// responses (GET /mine, PATCH /:id/wifi): those expose only `wifi_password_set`, never the secret.
// The ONE exception is the explicit per-screenhost reveal (GET /:id/wifi/reveal, owner-scoped; admin
// mirror at /api/admin/screenhosts/:id/wifi/reveal), which decrypts and returns the plaintext on
// demand for the venue's own owner (R1, Kais QA) — and for admins. The plaintext and the key are
// NEVER logged or echoed. Every successful edit re-pushes the owner's approved screenhosts to wedooh
// (S-T1 Edge B2) so the hub's stored credentials stay current.
const idParamSchema = z.object({ id: z.uuid() });

// SSID: set when provided (min 1; use null to clear). Password: a non-empty string is the new
// secret; '' or omitted means "leave unchanged" (the form is write-only — blank ≠ clear);
// explicit null clears it. At least one field required (empty PATCH → 400), mirroring profile.ts.
const wifiPatchSchema = z
  .object({
    wifi_ssid: z.string().min(1).max(64).nullable().optional(),
    wifi_password: z.string().max(128).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

type WifiPatchInput = z.infer<typeof wifiPatchSchema>;

// Shared projection — the password (cipher OR plain) never appears in a selection that reaches
// the wire; only its presence is reported.
const wifiSelection = {
  id: screenhosts.id,
  name: screenhosts.name,
  wifiSsid: screenhosts.wifiSsid,
  wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted,
};

interface WifiRow {
  id: string;
  name: string;
  wifiSsid: string | null;
  wifiPasswordEncrypted: string | null;
}

// Owner/admin-safe projection. wifi_password_set lets the UI render "a password is on file"
// without ever transmitting it.
const wifiView = (
  row: WifiRow,
): { id: string; name: string; wifi_ssid: string | null; wifi_password_set: boolean } => ({
  id: row.id,
  name: row.name,
  wifi_ssid: row.wifiSsid,
  wifi_password_set: row.wifiPasswordEncrypted !== null,
});

// Explicit-reveal projection — decrypts the stored secret on demand (null when none is set). Used
// ONLY by the per-screenhost reveal endpoints, never by the list/edit views, so the redaction
// elsewhere is preserved. The plaintext is returned but never logged.
const revealView = (row: {
  wifiPasswordEncrypted: string | null;
}): { wifi_password: string | null } => ({
  wifi_password:
    row.wifiPasswordEncrypted === null ? null : decryptWifiPassword(row.wifiPasswordEncrypted),
});

// Wire body → drizzle columns, applying the write-only password rules above.
const buildWifiPatch = (data: WifiPatchInput): Partial<typeof screenhosts.$inferInsert> => {
  const patch: Partial<typeof screenhosts.$inferInsert> = {};
  if (data.wifi_ssid !== undefined) patch.wifiSsid = data.wifi_ssid;
  if (data.wifi_password === null) {
    patch.wifiPasswordEncrypted = null;
  } else if (typeof data.wifi_password === 'string' && data.wifi_password.length > 0) {
    patch.wifiPasswordEncrypted = encryptWifiPassword(data.wifi_password);
  }
  return patch;
};

// Apply the patch when it carries an actual column change; report whether anything was written
// (so a no-op edit, e.g. blank password only, does not trigger a pointless re-push).
const applyWifiPatch = async (
  existing: WifiRow,
  data: WifiPatchInput,
): Promise<{ changed: boolean; row: WifiRow }> => {
  const patch = buildWifiPatch(data);
  if (Object.keys(patch).length === 0) return { changed: false, row: existing };
  const [updated] = await db
    .update(screenhosts)
    .set(patch)
    .where(eq(screenhosts.id, existing.id))
    .returning(wifiSelection);
  return { changed: true, row: updated ?? existing };
};

const adminGuard = { preHandler: [requireAuth, requireAdmin] };
// The owner app surface (GET /mine, PATCH /:id/wifi) is status-gated (N3): a rejected/banned owner
// is 403'd server-side, closing the FE-only enforcement gap. pending/approved pass (pending = the
// in-review carve-out). The admin route keeps adminGuard. Recovery routes live on other routers.
const ownerGuard = { preHandler: [requireAuth, requireActiveAccount] };

export const screenhostsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/screenhosts/mine — the caller's screenhosts, password-redacted.
  app.get('/api/screenhosts/mine', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select(wifiSelection)
      .from(screenhosts)
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(asc(screenhosts.name));
    return reply.status(200).send(rows.map(wifiView));
  });

  // PATCH /api/screenhosts/:id/wifi — owner-scoped edit + approved-owner re-push.
  app.patch('/api/screenhosts/:id/wifi', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = wifiPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [existing] = await db
      .select(wifiSelection)
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const result = await applyWifiPatch(existing, parsed.data);

    // Re-push ONLY for an approved owner: an unapproved owner's location must not reach wedooh
    // before admin approval (the hub invariant). Fire-and-forget — a wedooh outage must NEVER
    // fail this PATCH (export_status flips to 'failed'; the boot/interval sweep retries).
    if (result.changed && request.user?.status === 'approved') {
      void pushApprovedOwnerLocations(userId, request.log).catch((err: unknown) => {
        request.log.warn({ err }, 'wedooh WiFi re-push (owner edit) failed to start');
      });
    }
    return reply.status(200).send(wifiView(result.row));
  });

  // GET /api/screenhosts/:id/wifi/reveal — owner-scoped, explicit on-demand reveal of the CURRENT
  // WiFi password (R1, Kais QA). Same guard + owner-scoping as the PATCH: a foreign/missing id → 404,
  // indistinguishable. Decrypts and returns { wifi_password } (null when none set). The LIST stays
  // redacted; only this per-screenhost reveal returns plaintext, and it is never logged or echoed.
  app.get('/api/screenhosts/:id/wifi/reveal', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [existing] = await db
      .select({ wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    return reply.status(200).send(revealView(existing));
  });

  // GET /api/screenhosts/:id/affluence — owner-scoped read of the venue's audience pattern: the
  // "typical week" weekday × hour grid of estimated audience the hub pushes via POST
  // /api/internal/affluence (this is the first READER of screenhost_affluence — the ingest is
  // unchanged). Same owner-scoping as the WiFi routes: a foreign/missing id is a 404. Returns a
  // zero-filled 7×24 grid (grid[0]=Monday … grid[6]=Sunday; hour index 0–23, matching wedooh's
  // 1=Mon…7=Sun / 0–23 slots) + has_data, so the dashboard can show an empty state. Summaries
  // (peak day/hour, daily average, weekly total) are derived client-side from the grid.
  app.get('/api/screenhosts/:id/affluence', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const slots = await db
      .select({
        dayOfWeek: screenhostAffluence.dayOfWeek,
        hour: screenhostAffluence.hour,
        estimatedImpressions: screenhostAffluence.estimatedImpressions,
      })
      .from(screenhostAffluence)
      .where(eq(screenhostAffluence.screenhostId, owned.id));

    // Zero-filled 7×24 grid (Monday-first); day_of_week 1=Mon…7=Sun → row 0…6.
    const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const slot of slots) {
      const row = grid[slot.dayOfWeek - 1];
      if (row && slot.hour >= 0 && slot.hour <= 23) row[slot.hour] = slot.estimatedImpressions;
    }

    return reply.status(200).send({ grid, has_data: slots.length > 0 });
  });

  // PATCH /api/admin/screenhosts/:id/wifi — admin edit of ANY screenhost + re-push for its
  // approved owner. Same write-only password rules; goes through the toodooh API (NOT the
  // legacy Supabase admin-screens surface).
  app.patch('/api/admin/screenhosts/:id/wifi', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = wifiPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const [existing] = await db
      .select({ ...wifiSelection, ownerId: screenhosts.ownerId, ownerStatus: users.status })
      .from(screenhosts)
      .leftJoin(users, eq(screenhosts.ownerId, users.id))
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const result = await applyWifiPatch(existing, parsed.data);

    if (result.changed && existing.ownerId && existing.ownerStatus === 'approved') {
      void pushApprovedOwnerLocations(existing.ownerId, request.log).catch((err: unknown) => {
        request.log.warn({ err }, 'wedooh WiFi re-push (admin edit) failed to start');
      });
    }
    return reply.status(200).send(wifiView(result.row));
  });

  // GET /api/admin/screenhosts/:id/wifi/reveal — admin reveal of ANY screenhost's current WiFi
  // password (mirrors the owner reveal; adminGuard, no owner scoping). Same { wifi_password | null }
  // shape; the plaintext is never logged or echoed.
  app.get('/api/admin/screenhosts/:id/wifi/reveal', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }

    const [existing] = await db
      .select({ wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted })
      .from(screenhosts)
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    return reply.status(200).send(revealView(existing));
  });
};
