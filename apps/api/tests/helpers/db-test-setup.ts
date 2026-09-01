import { sql } from '../../src/db/client.js';

// Truncate all auth tables for per-test isolation. FK CASCADE from users covers
// accounts/sessions; verifications has no FK but is listed explicitly. Requires
// the schema to exist (CI runs `migrate` before tests; locally run it once).
export const resetAuthTables = async (): Promise<void> => {
  await sql`TRUNCATE users, accounts, sessions, verifications RESTART IDENTITY CASCADE`;
};

/**
 * MEJ-13-B — expand HOUR-shaped affluence fixtures onto BOTH halves of the hour, exactly as the
 * ingest does for an hour-shaped push (rule 2: same value in both halves — a cell is a level, so
 * half an hour of it is not half the people).
 *
 * Every existing fixture goes through this rather than writing a single half, which is the point:
 * the whole suite then runs against PRODUCTION-shaped data (48 rows a day), so if the hour-collapse
 * in any read path were wrong, the numbers those suites already assert would move. It turns the
 * existing tests into the invariant's regression net instead of leaving them on a shape production
 * never sees.
 */
// `const T` keeps literal types through the generic: without it `source: 'backup'` widens to
// `string` and no longer satisfies the column's enum.
export const bothHalves = <const T extends { hour: number }>(
  cells: T | readonly T[],
): (T & { slot: number })[] =>
  (Array.isArray(cells) ? (cells as readonly T[]) : [cells as T]).flatMap((cell: T) => [
    { ...cell, slot: cell.hour * 2 },
    { ...cell, slot: cell.hour * 2 + 1 },
  ]);
