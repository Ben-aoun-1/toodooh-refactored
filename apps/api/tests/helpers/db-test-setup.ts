import { sql } from '../../src/db/client.js';

// Truncate all auth tables for per-test isolation. FK CASCADE from users covers
// accounts/sessions; verifications has no FK but is listed explicitly. Requires
// the schema to exist (CI runs `migrate` before tests; locally run it once).
export const resetAuthTables = async (): Promise<void> => {
  await sql`TRUNCATE users, accounts, sessions, verifications RESTART IDENTITY CASCADE`;
};
