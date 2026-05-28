import { eq } from 'drizzle-orm';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

// Create (or upgrade) an admin account: signs up via better-auth so the password is hashed
// correctly, force-verifies the email (admin staff don't go through the email loop), and promotes
// to superadmin. Idempotent on re-run for an existing email (skips create, re-applies the flags).
// usage: pnpm --filter @toodooh/api tsx scripts/create-admin.ts <email> <password(>=12)> [name]
//
// 1h PROD CARRY-FORWARD: the password is passed as an argv (fine for local, where the chat/terminal
// is the record). NOT prod-safe — an argv/printed password can leak into shell history / CI logs.
// Before bootstrapping the PRODUCTION admin, add a prod-safe mode (read from stdin or an env var,
// never echo it) and run it interactively on the server. Easy fix; just don't use argv in prod.
const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] ?? 'Toodooh Admin';

const run = async (): Promise<void> => {
  if (!email || !password || password.length < 12) {
    console.error('usage: tsx scripts/create-admin.ts <email> <password(>=12 chars)> [name]');
    process.exit(1);
  }
  try {
    await auth.api.signUpEmail({ body: { email, password, name } });
    console.info(`created auth user ${email}`);
  } catch {
    // Already-exists or a best-effort verification-email send failure must not abort: the user row
    // is created before the email hook, so the flag-application below still applies.
    console.info('signUpEmail did not create a new user (exists or email-send failed); continuing');
  }
  const [row] = await db
    .update(users)
    .set({ emailVerified: true, role: 'superadmin', status: 'approved' })
    .where(eq(users.email, email))
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      emailVerified: users.emailVerified,
    });
  if (!row) {
    console.error(`no user found with email ${email} (create failed)`);
    process.exit(1);
  }
  console.info('admin ready:', row);
};

run()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('create-admin failed', err);
    await sql.end();
    process.exit(1);
  });
