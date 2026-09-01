import { sql as dsql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  HALVES_PER_HOUR,
  SLOTS_PER_DAY,
  collapseHalvesToHour,
  hourOfSlot,
  slotsOfHour,
} from '../src/lib/half-hour-slots.js';

// MEJ-13-B — the slot vocabulary and THE HOUR-COLLAPSE RULE, round((h0 + h1) / 2).
//
// The rule is written twice — once in TS for the merge paths, once as SQL for the hour-keyed reads
// — so the second describe runs BOTH on the same inputs and compares. Two expressions of one rule
// is exactly the shape that produced MEJ-14a's defect (the decorative bar widths agreed only by
// coincidence), so here they are pinned against each other rather than each against a constant.

describe('the slot vocabulary', () => {
  it('slot = hour × 2 + half, half 0 = :00–:29', () => {
    expect(slotsOfHour(0)).toEqual([0, 1]);
    expect(slotsOfHour(13)).toEqual([26, 27]);
    expect(slotsOfHour(23)).toEqual([46, 47]);
    expect(SLOTS_PER_DAY).toBe(48);
    expect(HALVES_PER_HOUR).toBe(2);
  });

  it('hourOfSlot inverts it, and mirrors the DB CHECK `hour = slot / 2`', () => {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
      expect(hourOfSlot(slot)).toBe(Math.floor(slot / 2));
    }
    expect(slotsOfHour(hourOfSlot(27))).toContain(27);
  });
});

describe('collapseHalvesToHour — the ruled rule', () => {
  it('EQUAL halves return the old value EXACTLY — the property the whole programme rests on', () => {
    // Every cell after the migration, and every cell an hour-shaped push writes, is equal halves.
    for (const v of [0, 1, 7, 40, 1396, 99999]) {
      expect(collapseHalvesToHour([v, v])).toBe(v);
    }
  });

  it('unequal halves give their mean, NOT the max and NOT the first', () => {
    expect(collapseHalvesToHour([10, 20])).toBe(15);
    // max() would inflate (20) and first() would truncate (10) — both on the money path.
    expect(collapseHalvesToHour([10, 20])).not.toBe(20);
    expect(collapseHalvesToHour([10, 20])).not.toBe(10);
  });

  it('a lone half collapses to itself — averaging against an absent reading would invent a zero', () => {
    expect(collapseHalvesToHour([40])).toBe(40);
    expect(collapseHalvesToHour([])).toBe(0);
  });

  it('rounds the .5 boundary rather than truncating', () => {
    expect(collapseHalvesToHour([10, 11])).toBe(11); // 10.5
    expect(collapseHalvesToHour([0, 1])).toBe(1); // 0.5
  });
});

describe('the SQL twin agrees with the TS rule (one rule, two expressions)', () => {
  const CASES: number[][] = [
    [0, 0],
    [40, 40],
    [1396, 1396],
    [10, 20],
    [10, 11], // .5 — Postgres round() is half-away-from-zero, Math.round is half-up
    [0, 1], // .5 again, at the bottom of the range
    [1, 0],
    [99999, 1],
    [7], // the lone half
  ];

  it('round(avg(v))::int in Postgres === collapseHalvesToHour in TS, case for case', async () => {
    for (const halves of CASES) {
      const values = dsql.join(
        halves.map((v) => dsql`(${v}::int)`),
        dsql`, `,
      );
      const rows = (await db.execute(
        dsql`select round(avg(v))::int as collapsed from (values ${values}) as t(v)`,
      )) as unknown as { collapsed: number }[];
      const fromSql = Number(rows[0]?.collapsed);
      expect(`${halves.join('+')} → ${fromSql}`).toBe(
        `${halves.join('+')} → ${collapseHalvesToHour(halves)}`,
      );
    }
  });
});

afterAll(async () => {
  await sql.end();
});
