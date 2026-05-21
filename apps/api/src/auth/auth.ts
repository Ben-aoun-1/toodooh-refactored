import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../logger.js';

interface VerificationEmailArgs {
  user: { id: string; email: string };
  url: string;
  token: string;
}

// Commit 4 replaces this body with the OVH SMTP send; the signature stays so
// the swap is body-only. better-auth invokes it as
// sendVerificationEmail({ user, url, token }, request) on signup.
export const sendVerificationEmailStub = async (args: VerificationEmailArgs): Promise<void> => {
  logger.info(
    {
      userId: args.user.id,
      email: args.user.email,
      verificationUrl: args.url,
      token: args.token,
    },
    'Verification email stub — Commit 4 replaces with OVH SMTP send',
  );
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
    sendVerificationEmail: sendVerificationEmailStub,
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
