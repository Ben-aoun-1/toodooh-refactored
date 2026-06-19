import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { emailSender } from '../auth/auth.js';
import { db } from '../db/client.js';
import { accounts, agents, users } from '../db/schema.js';
import {
  agentWelcomeEmailPlainText,
  agentWelcomeEmailSubject,
  agentWelcomeEmailTemplate,
} from '../email/welcome-agent-template.js';
import { env } from '../env.js';
import { generateUniqueAgentCode, type AgentCodePrefix } from '../lib/agent-code.js';
import { generateTempPassword } from '../lib/generate-password.js';
import { pushAgentToHub } from '../lib/wedooh-sync.js';
import { logger } from '../logger.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// The two agent roles get an issued referral code (held in agents.code), PREFIXED by the agent
// TYPE so the code is self-describing (Kais GTM spec): screenhost_agent → 'SH', screencast_agent
// → 'SC'. admin gets no code. This map is the single role→prefix source for this route; a null
// return is the "not an agent role" gate (replacing the old isAgentRole boolean).
const agentCodePrefix = (role: string): AgentCodePrefix | null => {
  if (role === 'screenhost_agent') return 'SH';
  if (role === 'screencast_agent') return 'SC';
  return null;
};

// Superadmin-only creation of INTERNAL accounts (staff admins + agents). These are NOT public
// signups: we deliberately do NOT use better-auth's signUpEmail (it sends a verification email —
// Ruling 9). The account is created verified + approved directly. The password is hashed with
// better-auth's DEFAULT hashPassword (better-auth/crypto), the same scheme auth.ts's
// emailAndPassword verifies on /api/signin, so the created account signs in normally (proven by
// the sign-in test). Ruling 10: a direct users + accounts DB transaction, not the better-auth admin
// plugin (which would add banned/impersonation schema).
//
// Per-role credential delivery (Kais GTM): AGENT roles get a SYSTEM-generated password, surfaced
// once in the create response AND sent in a non-blocking welcome email (with the agent code + a
// reset link). The staff ADMIN role keeps the admin-typed password and gets NO email — Ruling 9
// still stands for staff (credentials delivered out-of-band).
const superadminGuard = { preHandler: [requireAuth, requireRole('superadmin')] };

// role is constrained to the admin-creatable INTERNAL roles. superadmin is intentionally NOT
// creatable here (bootstrap-only, via scripts/create-admin.ts); end-user roles
// (advertiser/individual_owner/fleet_owner) sign up publicly, not here; `moderator` is not a
// user_role value (slice-2 A ruling 2). Password is OPTIONAL (agents generate their own) but
// REQUIRED for the admin role (refine); the ≥12 floor — the privileged-account floor (ruling 7),
// above the 10-char public-signup floor — is enforced whenever a password is present.
const createAccountSchema = z
  .object({
    email: z.email('A valid email is required'),
    password: z.string().min(12, 'Password must be at least 12 characters').optional(),
    contact_name: z.string().min(1).max(100),
    role: z.enum(['admin', 'screenhost_agent', 'screencast_agent']),
  })
  .refine((d) => d.role !== 'admin' || d.password !== undefined, {
    message: 'Password is required for the admin role',
    path: ['password'],
  });

// The shaped account view returned on create (snake_case wire; the identity subset, mirroring
// /api/me). No password/hash is ever echoed.
const toAccountView = (row: {
  id: string;
  email: string;
  role: string;
  status: string;
  contactName: string;
  emailVerified: boolean;
}) => ({
  id: row.id,
  email: row.email,
  role: row.role,
  status: row.status,
  contact_name: row.contactName,
  email_verified: row.emailVerified,
});

// Non-blocking welcome email for a newly-created AGENT (Kais GTM). Mirrors auth.ts's never-throw
// pattern (Decision 8): emailSender.send returns a result union and never throws, and we ALWAYS
// resolve — so a send failure is logged but can never fail account creation (which has already
// committed by the time this runs). The admin-UI panel that echoes the code + temp password is the
// reliable fallback when delivery is delayed or spam-filtered. resetUrl is the FE reset-request
// entry (no token needed — the agent enters their email there to set their own password); the temp
// password lets them sign in meanwhile.
const sendAgentWelcomeEmail = async (params: {
  to: string;
  name: string;
  agentCode: string;
  tempPassword: string;
}): Promise<void> => {
  const fields = {
    name: params.name,
    agentCode: params.agentCode,
    loginEmail: params.to,
    tempPassword: params.tempPassword,
    resetUrl: `${env.WEB_ORIGIN}/reset-password`,
  };
  try {
    const result = await emailSender.send({
      to: params.to,
      subject: agentWelcomeEmailSubject,
      html: agentWelcomeEmailTemplate(fields),
      text: agentWelcomeEmailPlainText(fields),
    });
    if ('error' in result) {
      logger.error({ to: params.to, error: result.error }, 'agent welcome email failed');
    } else {
      logger.info({ to: params.to, messageId: result.messageId }, 'agent welcome email sent');
    }
  } catch (err) {
    logger.error({ to: params.to, err }, 'agent welcome email threw (swallowed)');
  }
};

export const adminAccountsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/admin/accounts', superadminGuard, async (request, reply) => {
    const parsed = createAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { email, password, contact_name, role } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const prefix = agentCodePrefix(role);
    const isAgent = prefix !== null;

    const adminId = request.user?.id;
    if (!adminId) {
      // requireAuth guarantees request.user; this narrows the type + defends in depth.
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Superadmin-only → an explicit 409 on duplicate is acceptable (no anti-enumeration concern; the
    // actor is trusted, unlike public signup which returns a generic 201).
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (existing) {
      return reply.status(409).send({
        error: 'EMAIL_TAKEN',
        message: 'An account with this email already exists.',
        statusCode: 409,
        requestId: request.id,
        fields: [{ field: 'email', reason: 'already registered' }],
      });
    }

    // Agent roles get a strong system-generated password (the admin no longer types one); the admin
    // role keeps its typed password. Both hash with the same better-auth scheme, so /api/signin
    // verifies either identically.
    const plainPassword = isAgent ? generateTempPassword() : password;
    if (plainPassword === undefined) {
      // Unreachable: the schema refine requires a password for the admin role. This narrows the
      // type and defends in depth.
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Password is required.',
        statusCode: 400,
        requestId: request.id,
        fields: [{ field: 'password', reason: 'required' }],
      });
    }
    const passwordHash = await hashPassword(plainPassword);

    // user + credential account in ONE transaction: a created account must be atomically usable —
    // never an orphan user without a credential (the sequential-failure mode signup.ts works around).
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          contactName: contact_name,
          emailVerified: true,
          role,
          status: 'approved',
          validatedBy: adminId,
          validatedAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          role: users.role,
          status: users.status,
          contactName: users.contactName,
          emailVerified: users.emailVerified,
        });
      if (!user) throw new Error('internal account insert returned no row');
      // The credential account better-auth's signInEmail looks up: providerId='credential',
      // accountId=user.id (better-auth's convention for the email/password provider).
      await tx.insert(accounts).values({
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: passwordHash,
      });
      // Agent roles get a unique issued code in the SAME tx (atomic with the user), prefixed by
      // the agent type (SH/SC). The SELECT-check runs on tx so it sees this tx's own pending
      // rows; we never catch a unique-violation (which would poison the tx) —
      // generateUniqueAgentCode regenerates.
      let agentCode: string | null = null;
      if (prefix) {
        agentCode = await generateUniqueAgentCode(prefix, async (candidate) => {
          const [hit] = await tx
            .select({ code: agents.code })
            .from(agents)
            .where(eq(agents.code, candidate))
            .limit(1);
          return hit !== undefined;
        });
        await tx.insert(agents).values({ userId: user.id, code: agentCode });
      }
      return { user, agentCode };
    });

    // Agent roles, AFTER commit (so we only provision a persisted account): provision the agent to
    // the hub AND send the welcome email. BOTH are non-blocking and never fail the response.
    if (isAgent && created.agentCode) {
      // Hub provisioning — fire-and-forget (mirrors the location sync). The agent logs into the hub
      // with their code (= username) + this same generated password; the plaintext rides the authed
      // x-api-key channel and is never logged. A hub outage / unset env degrades silently.
      void pushAgentToHub(
        {
          toodooh_user_id: created.user.id,
          code: created.agentCode,
          email: normalizedEmail,
          password: plainPassword,
          role,
        },
        request.log,
      ).catch((err: unknown) => {
        request.log.warn(`hub agent push rejected: ${(err as Error).message}`);
      });
      // Welcome email — awaited but swallow-and-log (never throws); see sendAgentWelcomeEmail.
      await sendAgentWelcomeEmail({
        to: created.user.email,
        name: created.user.contactName,
        agentCode: created.agentCode,
        tempPassword: plainPassword,
      });
    }

    // account.code is the agent's OWN issued referral code (null for non-agent roles); it is NOT
    // users.agent_code (the referred-user attribution field). temp_password is the generated
    // password surfaced ONCE for the admin to relay (agent roles only; null for admin, whose
    // password was admin-chosen) — the stored HASH is still never echoed. P2 reads both for display.
    return reply.status(201).send({
      account: {
        ...toAccountView(created.user),
        code: created.agentCode,
        temp_password: isAgent ? plainPassword : null,
      },
    });
  });
};
