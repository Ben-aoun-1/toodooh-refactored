import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { proofOfPlay, screenhosts, screens, users } from '../db/schema.js';

// Screen-row generation (MAP M1 commit 2). Screens are materialized when a screenhost owner
// is APPROVED: screen_count rows per screenhost, named "Écran 1..N". The same rule backfills
// already-approved owners in migration 0014. Idempotent per screenhost — one that already
// has ANY screens is left alone (re-approval after a rejection must not duplicate, and an
// admin-adjusted fleet keeps its existing rows).
export const OWNER_ROLES = new Set(['individual_owner', 'fleet_owner']);

export const createMissingScreensForOwner = async (userId: string): Promise<void> => {
  const hosts = await db
    .select({ id: screenhosts.id, screenCount: screenhosts.screenCount })
    .from(screenhosts)
    .where(eq(screenhosts.ownerId, userId));
  if (hosts.length === 0) return;

  const withScreens = new Set(
    (
      await db
        .select({ screenhostId: screens.screenhostId })
        .from(screens)
        .where(
          inArray(
            screens.screenhostId,
            hosts.map((h) => h.id),
          ),
        )
    ).map((r) => r.screenhostId),
  );

  const rows = hosts
    .filter((h) => !withScreens.has(h.id) && h.screenCount > 0)
    .flatMap((h) =>
      Array.from({ length: h.screenCount }, (_, i) => ({
        screenhostId: h.id,
        name: `Écran ${i + 1}`,
      })),
    );
  if (rows.length > 0) await db.insert(screens).values(rows);
};

// Lane 5 (TV-app login) self-heal. A screenhost owner signs into the TV app expecting the
// screen they're holding to be openable, but screen rows only get materialized at approval
// from screen_count (createMissingScreensForOwner) — and an individual_owner's signup leaves
// screen_count at its 0 default (a fleet venue can also be declared with 0), so an APPROVED
// owner can end up with ZERO screen rows and an empty GET /api/screens/mine — nothing to pair.
// This guarantees the device read is never empty for an owner who actually has a venue: if the
// caller owns at least one screenhost but has no screen rows at all, register a single
// "Écran 1" on their first screenhost (by name, the order /mine lists in). Idempotent — a
// no-op the moment ANY screen exists, so it never fights createMissingScreensForOwner or a
// multi-screen fleet, and never over-provisions venues that already have screens. An owner
// with zero screenhosts is left untouched (no venue to attach a screen to).
export const ensureOwnerHasScreen = async (userId: string): Promise<void> => {
  const [existing] = await db
    .select({ id: screens.id })
    .from(screens)
    .innerJoin(screenhosts, eq(screens.screenhostId, screenhosts.id))
    .where(eq(screenhosts.ownerId, userId))
    .limit(1);
  if (existing) return;

  const [host] = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(eq(screenhosts.ownerId, userId))
    .orderBy(asc(screenhosts.name), asc(screenhosts.createdAt), asc(screenhosts.id))
    .limit(1);
  if (!host) return;

  await db.insert(screens).values({ screenhostId: host.id, name: 'Écran 1' });
};

// ── SCR-DECL1 — the declared screens / rooms edit, and the rows that follow it ─────────────────
// Operator rulings 2026-09-21 (Q1 owner AND admins edit, Q2 rows follow the count, D2, D3). ONE
// function, called by the owner route and its admin twin (routes/screenhost-declaration.ts):
//   • before the owner is approved only the columns change — approval materialises the rows
//     from screen_count, exactly as today (createMissingScreensForOwner above);
//   • once approved, createMissingScreensForOwner skips a venue that already has rows, so the edit
//     reconciles the rows itself — and so it does for a venue that ALREADY HAS rows whatever the
//     owner's status (approved → rejected → re-approved keeps the rows, approval would skip them):
//     raising adds « Écran N » rows at the lowest free numbers;
//     lowering deletes NEVER-INSTALLED rows only, highest numbers first, and a target below what
//     must stay is refused (the whole edit is — nothing changes).
// INSTALLED is ADM-FIX1's ruled predicate (paired_at OR last_seen_at). A row carrying proof of play
// is kept as well: proof_of_play.screen_id is ON DELETE RESTRICT (retain-as-evidence), and a proof
// does not stamp last_seen_at. One transaction, the screenhost row locked FOR UPDATE, so two edits
// of the same venue cannot interleave. `GET /api/screens/mine` (the APK) lists exactly these rows.
// No hub re-push (Q7): wedooh-sync's payload is left as it is.

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

export interface DeclarationEdit {
  screenCount?: number;
  roomCount?: number;
}

export interface DeclarationView {
  id: string;
  name: string;
  screen_count: number;
  room_count: number | null;
  /** The screens ROWS after the edit — what the APK can pair against. */
  screens_count: number;
}

export type DeclarationOutcome =
  | { kind: 'updated'; view: DeclarationView }
  | { kind: 'not_found' }
  | { kind: 'below_installed'; installed: number };

/** Who is editing: the venue's owner (scoped to their own venues) or an admin (any venue). */
export type DeclarationScope = { ownerId: string } | 'admin';

/** The French refusal when the target is below the rows that must stay (D3 → 409). */
export const belowInstalledMessage = (installed: number): string =>
  installed > 1
    ? `Ce lieu compte ${installed} écrans déjà installés : le nombre d'écrans ne peut pas descendre en dessous de ${installed}.`
    : `Ce lieu compte 1 écran déjà installé : le nombre d'écrans ne peut pas descendre en dessous de 1.`;

const SCREEN_NAME = /^Écran (\d+)$/;
const screenNumber = (name: string): number | null => {
  const match = SCREEN_NAME.exec(name);
  return match ? Number(match[1]) : null;
};

/** The next `count` « Écran N » names, lowest free numbers first, given the names in use. */
export const nextScreenNames = (used: readonly string[], count: number): string[] => {
  const taken = new Set(used.map(screenNumber).filter((n): n is number => n !== null));
  const names: string[] = [];
  for (let n = 1; names.length < count; n += 1) {
    if (!taken.has(n)) names.push(`Écran ${n}`);
  }
  return names;
};

/** Removable rows in deletion order: highest « Écran N » first; an unnumbered name goes last. */
export const deletionOrder = <T extends { name: string; createdAt: Date }>(rows: T[]): T[] =>
  [...rows].sort(
    (a, b) =>
      (screenNumber(b.name) ?? 0) - (screenNumber(a.name) ?? 0) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );

// The rows proof of play points at — never deletable (ON DELETE RESTRICT, retain-as-evidence).
const screensWithProof = async (tx: Tx, screenIds: string[]): Promise<Set<string>> => {
  if (screenIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ screenId: proofOfPlay.screenId })
    .from(proofOfPlay)
    .where(inArray(proofOfPlay.screenId, screenIds));
  return new Set(rows.map((r) => r.screenId));
};

// Rows follow the count (Q2). Returns the number of rows that must stay when the target is below it.
// A venue with no rows whose owner is not approved yet is left to approval (D2).
const reconcileScreenRows = async (
  tx: Tx,
  screenhostId: string,
  target: number,
  approved: boolean,
): Promise<{ refusedBelow: number } | null> => {
  const venueRows = await tx
    .select({
      id: screens.id,
      name: screens.name,
      createdAt: screens.createdAt,
      pairedAt: screens.pairedAt,
      lastSeenAt: screens.lastSeenAt,
    })
    .from(screens)
    .where(eq(screens.screenhostId, screenhostId));
  if (!approved && venueRows.length === 0) return null;
  const withProof = await screensWithProof(
    tx,
    venueRows.map((r) => r.id),
  );
  const rows = venueRows.map((r) => ({
    ...r,
    kept: r.pairedAt !== null || r.lastSeenAt !== null || withProof.has(r.id),
  }));
  const kept = rows.filter((r) => r.kept).length;
  if (target < kept) return { refusedBelow: kept };
  if (target > rows.length) {
    const names = nextScreenNames(
      rows.map((r) => r.name),
      target - rows.length,
    );
    await tx.insert(screens).values(names.map((name) => ({ screenhostId, name })));
  } else if (target < rows.length) {
    const doomed = deletionOrder(rows.filter((r) => !r.kept)).slice(0, rows.length - target);
    await tx.delete(screens).where(
      inArray(
        screens.id,
        doomed.map((r) => r.id),
      ),
    );
  }
  return null;
};

export const updateScreenDeclaration = (
  screenhostId: string,
  edit: DeclarationEdit,
  scope: DeclarationScope,
): Promise<DeclarationOutcome> =>
  db.transaction(async (tx): Promise<DeclarationOutcome> => {
    const [venue] = await tx
      .select({ id: screenhosts.id, ownerStatus: users.status })
      .from(screenhosts)
      .leftJoin(users, eq(users.id, screenhosts.ownerId))
      .where(
        scope === 'admin'
          ? eq(screenhosts.id, screenhostId)
          : and(eq(screenhosts.id, screenhostId), eq(screenhosts.ownerId, scope.ownerId)),
      )
      .limit(1)
      .for('update', { of: screenhosts });
    if (!venue) return { kind: 'not_found' };

    if (edit.screenCount !== undefined) {
      const approved = venue.ownerStatus === 'approved';
      const refused = await reconcileScreenRows(tx, venue.id, edit.screenCount, approved);
      if (refused) return { kind: 'below_installed', installed: refused.refusedBelow };
    }
    const [updated] = await tx
      .update(screenhosts)
      .set({
        ...(edit.screenCount !== undefined ? { screenCount: edit.screenCount } : {}),
        ...(edit.roomCount !== undefined ? { roomCount: edit.roomCount } : {}),
      })
      .where(eq(screenhosts.id, venue.id))
      .returning({
        id: screenhosts.id,
        name: screenhosts.name,
        screenCount: screenhosts.screenCount,
        roomCount: screenhosts.roomCount,
      });
    if (!updated) return { kind: 'not_found' };
    const [rows] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(screens)
      .where(eq(screens.screenhostId, venue.id));
    return {
      kind: 'updated',
      view: {
        id: updated.id,
        name: updated.name,
        screen_count: updated.screenCount,
        room_count: updated.roomCount,
        screens_count: rows?.n ?? 0,
      },
    };
  });
