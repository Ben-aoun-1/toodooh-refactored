import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { auth } from '../auth/auth.js';

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
// this via { preHandler: requireAuth }. This commit only VALIDATES sessions; creation
// is Phase-1d sign-in. getSession({ headers }) returns { session, user } | null
// (Commit 3 §2.2) — null → 401, never throws on the no-session path.
export const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    await reply.status(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      statusCode: 401,
      requestId: request.id,
    });
    return;
  }
  const sessionUser = session.user as { id: string; role?: string; status?: string };
  request.user = {
    id: sessionUser.id,
    role: sessionUser.role ?? 'advertiser',
    status: sessionUser.status ?? 'pending',
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
        message: 'Insufficient privileges for this action.',
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
      message: 'Your account does not have access to this resource.',
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
      message: 'Administrator access required.',
      statusCode: 403,
      requestId: request.id,
    });
    return;
  }
};
