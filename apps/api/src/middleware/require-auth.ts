import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export interface AuthUser {
  id: string;
  role: string;
  status: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// Reusable session-guard preHandler. Validates the better-auth session and attaches
// request.user; shaped-401 on no/invalid session. Every authenticated route attaches
// this via { preHandler: requireAuth }. getSession({ headers }) returns { session, user } | null
// — null → 401, never throws on the no-session path.
//
// CF-HF3 (Mejri item 5) — role resolution HARDENED: the old `role ?? 'advertiser'` silently
// DEGRADED a session whose serialized user lacked the role additionalField, turning a genuine
// admin into an advertiser and 403-ing every /api/admin/* call with « Accès administrateur
// requis » despite a valid admin session. A role/status-less session user now resolves from the
// users row instead of assuming; the defaults only apply when the row itself is gone.
export const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    await reply.status(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Authentification requise.',
      statusCode: 401,
      requestId: request.id,
    });
    return;
  }
  const sessionUser = session.user as { id: string; role?: string; status?: string };
  let role = sessionUser.role;
  let status = sessionUser.status;
  if (role === undefined || status === undefined) {
    try {
      const [row] = await db
        .select({ role: users.role, status: users.status })
        .from(users)
        .where(eq(users.id, sessionUser.id))
        .limit(1);
      role ??= row?.role;
      status ??= row?.status;
    } catch {
      // Unresolvable (e.g. a malformed id) — fall through to the conservative defaults below.
    }
  }
  request.user = {
    id: sessionUser.id,
    role: role ?? 'advertiser',
    status: status ?? 'pending',
  };
};

// Generic role-allowlist gate factory. Composes AFTER requireAuth (which attaches request.user):
// { preHandler: [requireAuth, requireRole('superadmin')] }. Used today by admin-accounts for
// superadmin-only account creation; future agent read endpoints may reuse it. An authenticated user
// whose role is not in the allowlist gets 403 (not 404) — mirrors requireAdmin.
export const requireRole =
  (...allowed: string[]) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = request.user?.role;
    if (role === undefined || !allowed.includes(role)) {
      await reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Privilèges insuffisants pour cette action.',
        statusCode: 403,
        requestId: request.id,
      });
      return;
    }
  };

// Statuses that have LOST app access: 'rejected' (recoverable via the resubmit loop, but no app
// surface) and 'banned' (terminal). 'pending' and 'approved' pass — a pending owner keeps its
// in-review dashboard/screenhost access (explicit product carve-out). Composes AFTER requireAuth.
const INACTIVE_STATUSES = new Set(['rejected', 'banned']);

// Account-status gate (N3 — server-side enforcement). Closes the FE-only gap: requireAuth attaches
// request.user.status (fresh — getSession is DB-backed, no cookieCache) but never gates on it, so a
// rejected owner with a still-valid session could call app-surface routes directly. Applied
// SURGICALLY (this commit: the screenhost app surface) — NOT to the rejected RECOVERY routes
// (/api/me, /api/profile/resubmit, /api/profile/documents*, PATCH /api/profile/bank), which a
// rejected user needs to fix + resubmit. Reads request.user.status, mirroring requireAdmin/requireRole.
export const requireActiveAccount = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (INACTIVE_STATUSES.has(request.user?.status ?? '')) {
    await reply.status(403).send({
      error: 'ACCOUNT_NOT_ACTIVE',
      message: "Votre compte n'a pas accès à cette ressource.",
      statusCode: 403,
      requestId: request.id,
    });
    return;
  }
};

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

// Admin role gate. Composes AFTER requireAuth in a preHandler array
// ({ preHandler: [requireAuth, requireAdmin] }) — requireAuth attaches request.user and
// 401s on no session; requireAdmin only adds the 403 role check. An authenticated non-admin
// gets 403 (not 404): /api/admin/* existing is not a leak.
export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const role = request.user?.role;
  if (role === undefined || !ADMIN_ROLES.has(role)) {
    await reply.status(403).send({
      error: 'FORBIDDEN',
      // CF-HF3 — French (the old 'Administrator access required.' reached admin toasts verbatim).
      message: 'Accès administrateur requis.',
      statusCode: 403,
      requestId: request.id,
    });
    return;
  }
};
