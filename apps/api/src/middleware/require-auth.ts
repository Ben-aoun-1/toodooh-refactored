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
