import { eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import { type Screenhost, type User, agentReferrals, screenhosts, users } from '../db/schema.js';
import { toProfileType } from '../lib/profile-type.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// Read-only agent dashboard (P2). An agent (screenhost_agent | screencast_agent) sees ONLY the
// clients it referred — the agent_referrals edge where agent_user_id = the caller. This endpoint
// NEVER exposes documents (no field, no presign): the hard divergence from the admin user view,
// which DOES surface document presence + a presign endpoint. Performance / commission /
// accepted-refused metrics are NOT here either — their source is the future wedooh affluence edge
// (a separate sync lane); the FE renders placeholders. Read-only: no write/mutation path.
const agentGuard = {
  preHandler: [requireAuth, requireRole('screenhost_agent', 'screencast_agent')],
};

// Visibility matrix (product ruling — implement exactly): screenhost_agent ↔ individual_owner /
// fleet_owner; screencast_agent ↔ advertiser / agency. agency is NOT a role (it is role advertiser
// + business_type 'agency'), so we classify clients by toProfileType — role alone is insufficient.
// The referred set is already type-consistent (P1 only linked on a compatible match); this is a
// DEFENSIVE second filter so a mis-seeded edge can never widen an agent's visibility.
const SCREENHOST_CLIENT_TYPES = new Set(['individual_owner', 'fleet_owner']);
const SCREENCAST_CLIENT_TYPES = new Set(['advertiser', 'agency']);

const allowedClientTypes = (agentRole: string): Set<string> =>
  agentRole === 'screenhost_agent' ? SCREENHOST_CLIENT_TYPES : SCREENCAST_CLIENT_TYPES;

// Screenhost (location) projection for screenhost-owner clients. Location/metadata ONLY — NEVER
// the wifi password ciphertext and NEVER the internal export-pipeline fields (export_status /
// exported_at). The agent has no business with either.
const toScreenhostView = (row: Screenhost) => ({
  id: row.id,
  name: row.name,
  latitude: row.latitude,
  longitude: row.longitude,
  screen_count: row.screenCount,
  address: row.address,
  city: row.city,
  postal_code: row.postalCode,
  governorate_id: row.governorateId,
  zone: row.zone,
  wifi_ssid: row.wifiSsid,
  is_active: row.isActive,
  created_at: row.createdAt,
});

// Referred-client projection. Mirrors the NON-DOCUMENT fields of admin.ts's toAdminUserView; the
// `documents` key and every doc URL are intentionally absent. `agent_code_used` is the raw value
// the client entered at signup (the audit trail carried on the referral edge). `screenhosts` holds
// the client's owned locations (populated only for screenhost owners; [] otherwise).
const toAgentClientView = (row: User, agentCodeUsed: string, locations: Screenhost[]) => ({
  id: row.id,
  email: row.email,
  email_verified: row.emailVerified,
  role: row.role,
  status: row.status,
  onboarding_completed: row.onboardingCompleted,
  profile_type: toProfileType(row.role, row.businessType),
  contact_name: row.contactName,
  business_name: row.businessName,
  business_type: row.businessType,
  tax_number: row.taxNumber,
  contact_phone: row.contactPhone,
  fonction: row.fonction,
  business_sector_id: row.businessSectorId,
  street_address: row.streetAddress,
  city: row.city,
  postal_code: row.postalCode,
  governorate_id: row.governorateId,
  zone: row.zone,
  agent_code_used: agentCodeUsed,
  created_at: row.createdAt,
  screenhosts: locations.map(toScreenhostView),
});

export const agentRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/agent/clients — the caller agent's referred clients (read-only). requireAuth attaches
  // request.user and 401s on no session; requireRole 403s a non-agent authenticated user.
  app.get('/api/agent/clients', agentGuard, async (request, reply) => {
    const agentUser = request.user;
    if (!agentUser) {
      // Unreachable after requireAuth, but the type is AuthUser | undefined — narrow it.
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // The caller's referred clients: agent_referrals (agent_user_id = caller) joined to the
    // referred user. The WHERE binds to the caller's id, so one agent NEVER sees another agent's
    // referrals.
    const rows = await db
      .select({ user: users, agentCodeUsed: agentReferrals.agentCodeUsed })
      .from(agentReferrals)
      .innerJoin(users, eq(users.id, agentReferrals.referredUserId))
      .where(eq(agentReferrals.agentUserId, agentUser.id));

    // Defensive profile-type-class filter (the visibility matrix above).
    const allowed = allowedClientTypes(agentUser.role);
    const clients = rows.filter((r) => {
      const profileType = toProfileType(r.user.role, r.user.businessType);
      return profileType !== null && allowed.has(profileType);
    });

    // Screenhost-owner clients also get their owned locations (screenhosts.owner_id). Batch-load
    // by owner id, then group, so the response is one extra query rather than N.
    const ownerIds = clients
      .filter((c) =>
        SCREENHOST_CLIENT_TYPES.has(toProfileType(c.user.role, c.user.businessType) ?? ''),
      )
      .map((c) => c.user.id);
    const locations = ownerIds.length
      ? await db.select().from(screenhosts).where(inArray(screenhosts.ownerId, ownerIds))
      : [];
    const byOwner = new Map<string, Screenhost[]>();
    for (const loc of locations) {
      if (loc.ownerId === null) continue;
      const list = byOwner.get(loc.ownerId) ?? [];
      list.push(loc);
      byOwner.set(loc.ownerId, list);
    }

    return reply.status(200).send({
      clients: clients.map((c) =>
        toAgentClientView(c.user, c.agentCodeUsed, byOwner.get(c.user.id) ?? []),
      ),
    });
  });
};
