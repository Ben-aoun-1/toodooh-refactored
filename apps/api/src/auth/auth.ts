import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema.js';
import {
  resetEmailPlainText,
  resetEmailSubject,
  resetEmailTemplate,
} from '../email/reset-template.js';
import { SmtpEmailSender } from '../email/smtp-sender.js';
import {
  verificationEmailPlainText,
  verificationEmailSubject,
  verificationEmailTemplate,
} from '../email/template.js';
import { env } from '../env.js';
import { logger } from '../logger.js';

// Exported for test spying. Per-send transport (no pool — Decision 2).
export const emailSender = new SmtpEmailSender(env);

// better-auth invokes this as sendVerificationEmail({ user, url, token }, request)
// on signup and AWAITS it (sign-up.mjs:243). It MUST NOT throw: a throw would
// fail signUpEmail and trip Commit 3's orphan-rollback, deleting the new user.
// So every error is swallowed here (Decision 8 / Commit 4 Q2).
const sendVerificationEmail = async (args: {
  user: { id: string; email: string; name?: string; role?: string };
  url: string;
  token: string;
}): Promise<void> => {
  const { user, url } = args;
  const role = user.role ?? 'advertiser';
  try {
    const result = await emailSender.send({
      to: user.email,
      subject: verificationEmailSubject,
      html: verificationEmailTemplate({ name: user.name ?? '', verificationUrl: url, role }),
      text: verificationEmailPlainText({ name: user.name ?? '', verificationUrl: url, role }),
    });
    if ('error' in result) {
      logger.error({ to: user.email, error: result.error }, 'verification email failed');
    } else {
      logger.info({ to: user.email, messageId: result.messageId }, 'verification email sent');
    }
  } catch (err) {
    logger.error({ to: user.email, err }, 'verification email threw (swallowed)');
  }
};

// better-auth invokes this as sendResetPassword({ user, url, token }) when
// requestPasswordReset runs for a KNOWN email, and AWAITS it (password.mjs:72).
// Like sendVerificationEmail it MUST NOT throw: a throw would fail
// requestPasswordReset, surfacing a 500 that leaks account existence (the very
// thing anti-enumeration prevents) and breaking the flow on an SMTP outage. So
// every error is swallowed here (Decision 8 / Commit 4 Q2).
const sendResetPassword = async (args: {
  user: { email: string; name?: string };
  url: string;
}): Promise<void> => {
  const { user, url } = args;
  try {
    const result = await emailSender.send({
      to: user.email,
      subject: resetEmailSubject,
      html: resetEmailTemplate({ name: user.name ?? '', resetUrl: url }),
      text: resetEmailPlainText({ name: user.name ?? '', resetUrl: url }),
    });
    if ('error' in result) {
      logger.error({ to: user.email, error: result.error }, 'reset email failed');
    } else {
      logger.info({ to: user.email, messageId: result.messageId }, 'reset email sent');
    }
  } catch (err) {
    logger.error({ to: user.email, err }, 'reset email threw (swallowed)');
  }
};

export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  // Well-formed verification URLs (Commit 3 Q8); prod overrides via env.
  baseURL: env.BETTER_AUTH_URL,
  // Honor the locked /auth/* mount (default is /api/auth — would 404).
  basePath: '/auth',
  // The browser's Origin (forwarded by the same-origin proxy) is WEB_ORIGIN, not
  // baseURL — without this, cookie-bearing non-GET auth requests 403 INVALID_ORIGIN
  // (origin-check.mjs). The third origin layer beyond CORS + SameSite.
  trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      account: accounts,
      session: sessions,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    // Wires /api/password/reset-request: better-auth emails the reset link only
    // for a real account (anti-enumeration is built in — password.mjs:50-72).
    sendResetPassword,
    // Forgot-password is a compromise scenario: invalidate every session so a
    // stale/stolen cookie can't outlive the reset. The user re-signs in (M3).
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    // B′ (Phase-1f F3): resend the verification email on an unverified signin so the verify-page
    // error CTA ("Connectez-vous pour recevoir un nouveau lien") is a real recovery loop for the
    // common expired-link case. better-auth rate-limits it, and it is only ever sent to the
    // account's own address. Changes Phase-1d behavior (then: 403 without resend; now: 403 + resend).
    sendOnSignIn: true,
    sendVerificationEmail,
  },
  user: {
    // Map better-auth's logical `name` field to the drizzle `contactName` property
    // (DB column contact_name) — the adapter resolves fields by drizzle property key
    // (Commit 3 §2.1). DB column matches the frontend contract wire name.
    fields: { name: 'contactName' },
    // role/status are server-controlled: input:false drops them from the
    // signup input schema so a payload can't self-elevate to superadmin
    // (Commit 2 Q2). Assignment happens via the promote script / admin APIs.
    additionalFields: {
      role: { type: 'string', required: false, input: false, defaultValue: 'advertiser' },
      status: { type: 'string', required: false, input: false, defaultValue: 'pending' },
      // Commit 3 — business profile fields, client-settable, written atomically
      // with the user row by signUpEmail. /api/signup's zod schema is the
      // authority on presence/format; required:false avoids coupling other
      // better-auth flows to these.
      businessName: { type: 'string', required: false, input: true },
      contactPhone: { type: 'string', required: false, input: true },
      taxNumber: { type: 'string', required: false, input: true },
    },
  },
  advanced: {
    // Defer ID generation to Postgres (uuid defaultRandom on every table).
    database: { generateId: false },
    // Pin the origin check explicitly rather than letting it derive from NODE_ENV:
    // better-auth defaults skipOriginCheck=true when isTest() (create-context.mjs),
    // which would silently disable a security control in tests and make tested != shipped.
    // false keeps it ON in every env (prod/dev already had it on) so the suite exercises
    // prod's real behavior. A security control's state should be explicit, not env-derived.
    disableOriginCheck: false,
  },
});
