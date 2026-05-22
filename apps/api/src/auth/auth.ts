import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema.js';
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

export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  // Well-formed verification URLs (Commit 3 Q8); prod overrides via env.
  baseURL: env.BETTER_AUTH_URL,
  // Honor the locked /auth/* mount (default is /api/auth — would 404).
  basePath: '/auth',
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
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail,
  },
  user: {
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
  },
});
