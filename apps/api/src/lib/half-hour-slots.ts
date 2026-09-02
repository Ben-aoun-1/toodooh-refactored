import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * MEJ-13-B — the half-hour slot vocabulary, in one place.
 *
 * A slot is 0–47, `slot = hour × 2 + half`, half 0 = :00–:29, on the venue's own Africa/Tunis
 * clock. Both affluence tables are keyed on it since the wire gained half-hour resolution.
 *
 * THE INVARIANT the whole programme is built to defend: **no headline number may move because the
 * grid got finer.** A cell is a LEVEL — people PRESENT during the slot — not a flow. Half an hour
 * of a level is not half the people, so an hour expands into both halves carrying the SAME value.
 */

/** Slots per hour, and therefore the expansion factor of an hour-shaped push. */
export const HALVES_PER_HOUR = 2;
/** 0–47. */
export const SLOTS_PER_DAY = 24 * HALVES_PER_HOUR;

/**
 * Slice C — the DURATION of one slot, in hours. Every sum over slots is weighted by it:
 * `Σ (value × SLOT_HOURS)`.
 *
 * This is the whole defence of the invariant. A cell is a LEVEL, so a day's audience is the
 * integral of that level over the day, not the sum of its cells. Summing 48 cells unweighted would
 * DOUBLE every audience total, every monthly report and every `estimated_impressions` the day the
 * grid got finer — the failure mode that is not a crash, just every number quietly ×2.
 *
 * On equal halves `Σ (v × 0.5)` over two halves is exactly `v` over the hour, so every existing
 * number is bit-identical. That equality is the pin, not a happy accident.
 */
export const SLOT_HOURS = 1 / HALVES_PER_HOUR;

/** The two slots an hour occupies, in order: [:00–:29, :30–:59]. */
export const slotsOfHour = (hour: number): [number, number] => [
  hour * HALVES_PER_HOUR,
  hour * HALVES_PER_HOUR + 1,
];

/** The hour a slot falls in — integer division, mirroring the DB's `hour = slot / 2` CHECK. */
export const hourOfSlot = (slot: number): number => Math.floor(slot / HALVES_PER_HOUR);

/**
 * THE HOUR-COLLAPSE RULE (ruled 2026-09-01) — what a half-hour grid answers to an HOUR-keyed
 * consumer:
 *
 *     hour_value = round((h0 + h1) / 2)
 *
 * It is DERIVED from the level semantics, not chosen: an hour spanning two halves carries their
 * time-weighted average. Three properties make it the only defensible rule, and each one is a bug
 * that would otherwise be on the money path:
 *
 * 1. **Equal halves return the old value EXACTLY** — which is every cell after the migration and
 *    every cell an hour-shaped push writes. That is what keeps the wire bit-identical on unchanged
 *    input, and it IS the acceptance test for the programme.
 * 2. It is the invariant's `Σ (value × slot_hours)` read at hour granularity, so this collapse and
 *    slice C's duration-weighted sums can never disagree.
 * 3. `max()` would silently INFLATE and `first()` (or a last-write-wins map) would silently
 *    TRUNCATE `estimated_impressions` the moment the halves differ — on the dispatch / C_max /
 *    event-pricing / settlement path.
 *
 * A single half (only one row present) collapses to itself: averaging it against an absent
 * reading would invent a zero, and a missing cell is "no measure", never a zero.
 */
export const collapseHalvesToHour = (halves: readonly number[]): number => {
  if (halves.length === 0) return 0;
  const sum = halves.reduce((total, value) => total + value, 0);
  return Math.round(sum / halves.length);
};

/**
 * The SAME collapse, expressed for SQL so an hour-keyed read can do it in the database rather than
 * hauling both halves into JS. `round(avg(v))` over a `GROUP BY … , hour` is exactly
 * `round((h0 + h1) / 2)` for a full hour, and exactly the surviving half when only one row exists.
 *
 * There are two expressions of one rule, so `half-hour-slots.test.ts` pins them AGAINST EACH OTHER
 * on the same inputs, including the .5 boundary — Postgres `round()` on a numeric is half-away-
 * from-zero and JS `Math.round` is half-up, which agree for the non-negative values these columns
 * hold (both CHECK >= 0) and would silently diverge if that ever stopped being true.
 */
export const collapseHalvesSql = (column: AnyPgColumn): SQL<number> =>
  sql<number>`round(avg(${column}))::int`;

/**
 * S02-FUT1 (Mejri, ruled 2026-09-02) — the current half-hour slot on the **Africa/Tunis** clock.
 *
 * The boundary between a slot that has ELAPSED and one that has not. It mirrors
 * `dispatch/redispatch.ts`'s `tunisNowSlot` / `isElapsed`, which have carried the same rule at hour
 * granularity since E6: **the in-progress slot is NOT elapsed.** Same rule, finer grid — not a new
 * idea, and deliberately worded the same way so the two cannot drift apart in meaning.
 */
export const tunisSlotOf = (now: Date): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Tunis',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const at = (type: 'hour' | 'minute'): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = at('hour') % 24; // en-GB can render midnight as 24
  return hour * HALVES_PER_HOUR + (at('minute') >= 30 ? 1 : 0);
};

/**
 * OFF-1 — « this manual cell currently applies ». THE predicate, in ONE place, for all four
 * readers of `screenhost_affluence`.
 *
 * `IS NOT FALSE` is the whole rule: NULL (unknown — every row predating the flag, and every hub
 * that does not send it) and TRUE both pass; only an explicit FALSE is excluded. That is what
 * makes this deploy inert until the hub starts sending.
 *
 * ⚠️ IT MUST GO IN THE `WHERE`, BEFORE THE HOUR-COLLAPSE — never applied to the result.
 * `collapseHalvesSql` averages the halves of an hour, so a suspended half averaged in and then
 * removed would still carry half of a value the rule says does not exist: on a pair of 56 and a
 * suspended 20, filtering afterwards yields 38 where the answer is 56. Pinned by test.
 *
 * Four call sites, one predicate, because the MEJ-13-B lane paid for the lesson that a rule
 * copied per reader drifts per reader.
 */
export const inEffectSql = (column: AnyPgColumn): SQL<unknown> => sql`${column} IS NOT FALSE`;
