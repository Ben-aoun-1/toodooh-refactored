import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/require-auth.js';

const resetRequestSchema = z.object({ email: z.email('A valid email is required') });
const resetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  new_password: z.string().min(12, 'Password must be at least 12 characters'),
});
const changeSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(12, 'Password must be at least 12 characters'),
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
