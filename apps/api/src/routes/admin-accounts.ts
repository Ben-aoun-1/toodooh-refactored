import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { accounts, agents, users } from '../db/schema.js';
import { generateUniqueAgentCode } from '../lib/agent-code.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// The two agent roles get an issued referral code (held in agents.code). admin does not.
const isAgentRole = (role: string): boolean =>
  role === 'screenhost_agent' || role === 'screencast_agent';

// Superadmin-only creation of INTERNAL accounts (staff admins + agents). These are NOT public
// signups: we deliberately do NOT use better-auth's signUpEmail (it sends a verification email —
// Ruling 9). The account is created verified + approved directly; credentials are delivered
// out-of-band. The password is hashed with better-auth's DEFAULT hashPassword (better-auth/crypto),
// the same scheme auth.ts's emailAndPassword verifies on /api/signin, so the created account signs
// in normally (proven by the sign-in test). Ruling 10: a direct users + accounts DB transaction,
// not the better-auth admin plugin (which would add banned/impersonation schema).
const superadminGuard = { preHandler: [requireAuth, requireRole('superadmin')] };

// role is constrained to the admin-creatable INTERNAL roles. superadmin is intentionally NOT
// creatable here (bootstrap-only, via scripts/create-admin.ts); end-user roles
// (advertiser/individual_owner/fleet_owner) sign up publicly, not here; `moderator` is not a
// user_role value (slice-2 A ruling 2). Password floor is 12 — the privileged-account floor
// (ruling 7), above the 10-char public-signup floor.
const createAccountSchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  contact_name: z.string().min(1).max(100),
  role: z.enum(['admin', 'screenhost_agent', 'screencast_agent']),
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

    const passwordHash = await hashPassword(password);

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
      // Agent roles get a unique issued code in the SAME tx (atomic with the user). The
      // SELECT-check runs on tx so it sees this tx's own pending rows; we never catch a
      // unique-violation (which would poison the tx) — generateUniqueAgentCode regenerates.
      let agentCode: string | null = null;
      if (isAgentRole(role)) {
        agentCode = await generateUniqueAgentCode(async (candidate) => {
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

    // account.code is the agent's OWN issued referral code (null for non-agent roles); it is
    // NOT users.agent_code (the referred-user attribution field). P2 reads it for display.
    return reply
      .status(201)
      .send({ account: { ...toAccountView(created.user), code: created.agentCode } });
  });
};
