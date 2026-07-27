import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// EV1 rider (the CF-HF3 watch-item, ruled LEGAL): a ONE-DAY campaign (start = end) advances
// through the Période step. The old strict `startDate >= endDate` disable was the ONLY blocker
// in the chain (no server mirror; the engine window is inclusive — pinned api-side in
// one-day-campaign.test.ts). Source-pinned (no render harness).

const source = readFileSync(
  fileURLToPath(new URL('../../pages/new-campaign/StepDates.tsx', import.meta.url)),
  'utf8',
);

describe('StepDates — one-day campaigns are legal', () => {
  it('Suivant only disables on a genuinely INVERTED range (strict >), never on equality', () => {
    expect(source).toContain('startDate > endDate || saving');
    expect(source).not.toContain('startDate >= endDate');
  });

  it('the field validators allow equality and say « ou égale »', () => {
    expect(source).toContain('date > otherDate');
    expect(source).toContain('date < otherDate');
    expect(source).toContain('antérieure ou égale');
    expect(source).toContain('postérieure ou égale');
    expect(source).not.toContain('date >= otherDate');
    expect(source).not.toContain('date <= otherDate');
  });

  it('the durée is INCLUSIVE like the engine and the recap (30→30 = 1 jour)', () => {
    expect(source).toContain('+ 1');
    expect(source).toContain('if (ms < 0) return 0');
  });
});
