import { hashPassword } from 'better-auth/crypto';
import { desc, eq, inArray } from 'drizzle-orm';
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

// ADM-ADM1 — the staff-admin roles the /admin-management page lists and (re)activates. `moderator`
// is not a user_role value (slice-2 A ruling 2) and there is no permissions concept in this model.
const ADMIN_ROLES = ['admin', 'superadmin'] as const;
const idParamSchema = z.object({ id: z.uuid() });

// users carries ONE contact_name (no first/last split). The admin list exposes both: the full name
// verbatim, plus a first/last split on the first space for the page's initials/badges. Lossy by
// nature (a mononym has an empty last_name) — display sugar only, never written back.
export const splitContactName = (contactName: string): { first: string; last: string } => {
  const trimmed = contactName.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1) return { first: trimmed, last: '' };
  return { first: trimmed.slice(0, space), last: trimmed.slice(space + 1).trim() };
};

// The admin-account view of a users row: is_active = "not banned" (deactivating an admin IS the
// existing POST /api/admin/users/:id/ban — sessions revoked, sign-in blocked; unban restores).
const toAdminAccountView = (row: {
  id: string;
  email: string;
  contactName: string;
  role: string;
  status: string;
  createdAt: Date;
}) => {
  const { first, last } = splitContactName(row.contactName);
  return {
    id: row.id,
    email: row.email,
    contact_name: row.contactName,
    first_name: first,
    last_name: last,
    role: row.role,
    is_active: row.status !== 'banned',
    created_at: row.createdAt,
  };
};

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

  // Superadmin-only read of every issued agent + its hub-provisioning status (FX3). This is the
  // tested "read returns the status" layer for operator monitoring (a hub-down at create-time stamps
  // export_status='failed' instead of silently stranding). The agent-listing UI that consumes this
  // is the deferred 2.7 admin repoint — out of this commit. innerJoin agents = agent-only by
  // construction (admin/owner users have no agents row).
  app.get('/api/admin/agents', superadminGuard, async (_request, reply) => {
    const rows = await db
      .select({
        email: users.email,
        contact_name: users.contactName,
        role: users.role,
        code: agents.code,
        export_status: agents.exportStatus,
      })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.userId))
      .orderBy(desc(agents.createdAt));
    return reply.status(200).send({ agents: rows });
  });

  // GET /api/admin/admins — ADM-ADM1: every staff account (admin + superadmin), newest first, for
  // the superadmin-only /admin-management page. Replaces the dead Supabase `admin_profiles` read.
  app.get('/api/admin/admins', superadminGuard, async (_request, reply) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        contactName: users.contactName,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(inArray(users.role, [...ADMIN_ROLES]))
      .orderBy(desc(users.createdAt));
    return reply.status(200).send({ admins: rows.map(toAdminAccountView) });
  });

  // POST /api/admin/users/:id/unban — ADM-ADM1: reactivate a deactivated STAFF account. Deactivation
  // reuses the existing ban route (status→'banned' + sessions revoked); this is its inverse for
  // admin-role targets ONLY. End-user bans stay TERMINAL (N3 Scenario 2 ruling — fraud evidence,
  // no recovery path): a non-admin target is refused, whatever its status. Superadmin-only, like
  // account creation. Restores 'approved' (staff accounts are created approved — there is no
  // moderation state to return to) and stamps the actor on the validation trio; the ban reason is
  // cleared with it. 409 if the target is not banned.
  app.post('/api/admin/users/:id/unban', superadminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: [{ field: 'id', reason: 'must be a valid uuid' }],
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;
    const [existing] = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    if (!(ADMIN_ROLES as readonly string[]).includes(existing.role)) {
      return reply.status(409).send({
        error: 'NOT_ADMIN_ACCOUNT',
        message: 'Only staff (admin) accounts can be reactivated; end-user bans are terminal.',
        statusCode: 409,
        requestId: request.id,
      });
    }
    if (existing.status !== 'banned') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: `User already ${existing.status}.`,
        statusCode: 409,
        requestId: request.id,
        currentStatus: existing.status,
      });
    }
    const [updated] = await db
      .update(users)
      .set({
        status: 'approved',
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: null,
      })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        contactName: users.contactName,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
      });
    if (!updated) throw new Error('unban update returned no row');
    return reply.status(200).send({ account: toAdminAccountView(updated) });
  });
};
