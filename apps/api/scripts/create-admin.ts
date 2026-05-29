import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { eq } from 'drizzle-orm';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

// Create (or upgrade) an admin account: signs up via better-auth so the password is hashed
// correctly, force-verifies the email (admin staff don't go through the email loop), and promotes
// to superadmin. Idempotent on re-run for an existing email (skips create, re-applies the flags).
//
// usage: tsx scripts/create-admin.ts <email> [name]
//   password source (prod-safe — never echoed): ADMIN_PASSWORD env  ──or──  piped stdin.
//   local-only convenience: --generate-and-print-unsafe generates + PRINTS a password (opt-in;
//   NEVER use in prod — a printed password leaks into shell history / CI logs).
const MIN_PASSWORD_LEN = 12;
const UNSAFE_FLAG = '--generate-and-print-unsafe';

interface PasswordSources {
  env?: string;
  stdin?: string;
  generateUnsafe: boolean;
}

interface ResolvedPassword {
  password: string;
  generated: boolean;
}

// Pure resolver (tested): ADMIN_PASSWORD env → piped stdin → generate-if-unsafe-opted-in → throw.
// Throws on no source or a too-short supplied password; never returns without a valid password.
export const resolveAdminPassword = (src: PasswordSources): ResolvedPassword => {
  const supplied = src.env?.trim() || src.stdin?.trim();
  if (supplied) {
    if (supplied.length < MIN_PASSWORD_LEN) {
      throw new Error(`password must be at least ${MIN_PASSWORD_LEN} characters`);
    }
    return { password: supplied, generated: false };
  }
  if (src.generateUnsafe) {
    // 24 url-safe bytes → comfortably > 12 chars, mixed classes.
    return { password: randomBytes(18).toString('base64url'), generated: true };
  }
  throw new Error(
    `no password source — set ADMIN_PASSWORD, pipe one via stdin, or pass ${UNSAFE_FLAG} (local only)`,
  );
};

const readStdin = async (): Promise<string | undefined> => {
  // Only consume stdin when it is piped (not an interactive TTY).
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const value = Buffer.concat(chunks).toString('utf8').trim();
  return value || undefined;
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2).filter((a) => a !== UNSAFE_FLAG);
  const generateUnsafe = process.argv.includes(UNSAFE_FLAG);
  const email = args[0];
  const name = args[1] ?? 'Toodooh Admin';
  if (!email) {
    console.error(
      `usage: tsx scripts/create-admin.ts <email> [name]  (password via ADMIN_PASSWORD env or stdin)`,
    );
    process.exit(1);
  }

  const { password, generated } = resolveAdminPassword({
    env: process.env['ADMIN_PASSWORD'],
    stdin: await readStdin(),
    generateUnsafe,
  });

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
    .returning({ id: users.id, email: users.email, role: users.role, status: users.status });
  if (!row) {
    console.error(`no user found with email ${email} (create failed)`);
    process.exit(1);
  }
  console.info('admin ready:', row);
  // ONLY printed in the explicit local-unsafe path; never for env/stdin-supplied passwords.
  if (generated)
    console.info(`generated password (store it now, it will not be shown again): ${password}`);
};

// Side-effecting entry guarded so the module is importable by tests without running.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then(async () => {
      await sql.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('create-admin failed', err instanceof Error ? err.message : err);
      await sql.end();
      process.exit(1);
    });
}
