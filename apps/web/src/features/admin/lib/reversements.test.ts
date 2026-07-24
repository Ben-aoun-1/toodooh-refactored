import { describe, expect, it } from 'vitest';

import {
  REVERSEMENT_ROW_LABELS,
  reversementDisplayRows,
  type AdminReversementTotals,
} from './reversements';

// E7 — the admin settlement breakdown's pure display model: the four French labels are PINNED
// (charter verbatim) and the rows keep the split order SH / Toodooh / Agent SH / Agent SC.

const totals: AdminReversementTotals = {
  base_value_tnd: 200,
  sh_amount_tnd: 100,
  toodooh_amount_tnd: 88,
  agent_sh_amount_tnd: 6,
  agent_sc_amount_tnd: 6,
};

describe('REVERSEMENT_ROW_LABELS', () => {
  it('pins the four French labels verbatim', () => {
    expect(REVERSEMENT_ROW_LABELS).toEqual({
      sh: 'Part établissement (50 %)',
      toodooh: 'Part Toodooh (44 %)',
      agentSh: 'Agent établissement (3 %)',
      agentSc: 'Agent commercial (3 %)',
    });
  });
});

describe('reversementDisplayRows', () => {
  it('maps the totals to labeled rows in split order', () => {
    expect(reversementDisplayRows(totals)).toEqual([
      { key: 'sh', label: 'Part établissement (50 %)', amountTnd: 100 },
      { key: 'toodooh', label: 'Part Toodooh (44 %)', amountTnd: 88 },
      { key: 'agentSh', label: 'Agent établissement (3 %)', amountTnd: 6 },
      { key: 'agentSc', label: 'Agent commercial (3 %)', amountTnd: 6 },
    ]);
  });

  it('keeps the exact-sum property visible: the four rows sum to the base', () => {
    const rows = reversementDisplayRows(totals);
    expect(rows.reduce((s, r) => s + r.amountTnd, 0)).toBe(totals.base_value_tnd);
  });
});
