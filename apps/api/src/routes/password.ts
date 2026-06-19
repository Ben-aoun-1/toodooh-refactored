import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { agents, users, verifications } from '../db/schema.js';
import { env } from '../env.js';
import { pushAgentToHub } from '../lib/wedooh-sync.js';
import { requireAuth } from '../middleware/require-auth.js';

const resetRequestSchema = z.object({ email: z.email('A valid email is required') });
const resetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  new_password: z.string().min(10, 'Password must be at least 10 characters'),
});
const changeSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(10, 'Password must be at least 10 characters'),
});

const invalidInput = (
  reply: FastifyReply,
  issues: { path: (string | number | symbol)[]; message: string }[],
): FastifyReply =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

// Same pattern as signin: getSetCookie returns the array, avoiding the
// Headers.forEach comma-join footgun when better-auth sets multiple cookies.
const forwardSetCookie = (reply: FastifyReply, headers: Headers): void => {
  for (const cookie of headers.getSetCookie()) void reply.header('set-cookie', cookie);
};

// Agent reset → hub propagation (Kais credential model: hub login-by-code must use the NEW
// password). The reset token is a verifications row (identifier 'reset-password:<token>', value =
// userId — better-auth password.mjs). Resolve the userId from it BEFORE resetPassword consumes the
// row. null for a bogus token (no row).
const RESET_VERIFICATION_PREFIX = 'reset-password:';
const resolveResetUserId = async (token: string): Promise<string | null> => {
  const [row] = await db
    .select({ value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, `${RESET_VERIFICATION_PREFIX}${token}`))
    .limit(1);
  return row?.value ?? null;
};

// After a successful reset, push an AGENT's NEW password to the hub so login-by-code there rotates
// to it (HB2's idempotent upsert rotates the hub scrypt hash). The agent lookup is awaited (cheap,
// indexed) and the innerJoin on agents IS the agent-only gate — a non-agent (admin/owner) has no
// agents row, so nothing propagates. Only the slow hub push is fire-and-forget; its env-gating +
// never-throw live in pushAgentToHub (TA4), so a hub outage / unset sync env never delays or fails
// the reset. Wrapped so even a lookup error can't fail the already-succeeded reset. The new plaintext
// rides the authed x-api-key channel and is never logged.
const propagateAgentPasswordReset = async (
  userId: string,
  newPassword: string,
  log: FastifyBaseLogger,
): Promise<void> => {
  try {
    const [agent] = await db
      .select({ email: users.email, role: users.role, code: agents.code })
      .from(users)
      .innerJoin(agents, eq(agents.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!agent) return; // non-agent → no propagation
    void pushAgentToHub(
      {
        toodooh_user_id: userId,
        code: agent.code,
        email: agent.email,
        password: newPassword,
        role: agent.role,
      },
      log,
    ).catch((err: unknown) => {
      log.warn(`hub reset propagation rejected: ${(err as Error).message}`);
    });
  } catch (err) {
    log.warn(`hub reset propagation lookup failed: ${(err as Error).message}`);
  }
};

export const passwordRoutes: FastifyPluginAsync = async (app) => {
  // Unauthenticated. Generic success regardless of whether the email exists
  // (better-auth timing-equalizes + returns an identical body; the email only
  // sends for a real account — anti-enumeration, password.mjs:50-72).
  app.post('/api/password/reset-request', async (request, reply) => {
    const parsed = resetRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, parsed.error.issues);
    await auth.api.requestPasswordReset({
      // redirectTo is the FE reset-landing (Phase-1f F6); better-auth's reset link
      // (/auth/reset-password/:token) redirects there with ?token= (or ?error=). Absolute →
      // passes originCheck (WEB_ORIGIN trusted). Without it the link has no FE target.
      body: { email: parsed.data.email, redirectTo: `${env.WEB_ORIGIN}/update-password` },
      headers: fromNodeHeaders(request.headers),
    });
    return reply.status(200).send({
      success: true,
      message: 'If this email exists, a reset link has been sent.',
    });
  });

  // Unauthenticated. Token + new password (≥12). better-auth validates the
  // token row + length and invalidates sessions (revokeSessionsOnPasswordReset).
  app.post('/api/password/reset', async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, parsed.error.issues);
    // Capture the userId from the token's verification BEFORE the reset (better-auth deletes the row
    // on success). null for a bogus token → no propagation, and the reset 400s below.
    const userId = await resolveResetUserId(parsed.data.token);
    try {
      await auth.api.resetPassword({
        body: { token: parsed.data.token, newPassword: parsed.data.new_password },
        headers: fromNodeHeaders(request.headers),
      });
    } catch (err) {
      if (err instanceof APIError) {
        return reply
          .status(400)
          .send({ error: 'INVALID_TOKEN', message: 'This reset link is invalid or has expired.' });
      }
      request.log.error(err, 'password reset failed');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again.',
      });
    }
    // Reset succeeded → propagate an agent's new password to the hub (best-effort, non-blocking;
    // see propagateAgentPasswordReset — never throws, never fails the reset).
    if (userId) await propagateAgentPasswordReset(userId, parsed.data.new_password, request.log);
    return reply.status(200).send({ success: true });
  });

  // Authenticated. Re-auths the current password; invalidates other sessions,
  // keeps the current device alive via the refreshed cookie (revokeOtherSessions
  // → delete-all + new session, update-user.mjs:148-183).
  app.post('/api/password/change', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changeSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, parsed.error.issues);
    // Local fn so Awaited<ReturnType<...>> captures the returnHeaders:true overload shape.
    const change = () =>
      auth.api.changePassword({
        body: {
          currentPassword: parsed.data.current_password,
          newPassword: parsed.data.new_password,
          revokeOtherSessions: true,
        },
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
    let result: Awaited<ReturnType<typeof change>>;
    try {
      result = await change();
    } catch (err) {
      if (err instanceof APIError) {
        // wrong current password (INVALID_PASSWORD) → generic 400; length is caught by zod above.
        return reply
          .status(400)
          .send({ error: 'INVALID_CREDENTIALS', message: 'The current password is incorrect.' });
      }
      request.log.error(err, 'password change failed');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again.',
      });
    }
    forwardSetCookie(reply, result.headers); // the refreshed current-session cookie
    return reply.status(200).send({ success: true });
  });
};
