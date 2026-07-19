import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PILL_CTA_CLASSES } from './PillButton';

// CF-U2 (operator ruling 2026-07-18) — the primary CTA is FLAT brand green; the CF-U1
// green→black gradient is retired. These pins keep the ruling from regressing.

const SRC = join(__dirname, '..');
const listSources = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
};

describe('PillButton — the flat CTA ruling', () => {
  it('the active variant is flat brand green, pill-shaped, with NO gradient class', () => {
    expect(PILL_CTA_CLASSES).toContain('bg-brand-primary');
    expect(PILL_CTA_CLASSES).toContain('text-brand-deep');
    expect(PILL_CTA_CLASSES).not.toMatch(/gradient|from-|via-|to-/);
  });

  it('the retired GradientPillButton has no survivors anywhere in apps/web/src', () => {
    const hits = listSources(SRC).filter(
      (f) =>
        !f.endsWith('pill-button.test.ts') &&
        readFileSync(f, 'utf8').includes('GradientPillButton'),
    );
    expect(hits).toEqual([]);
  });

  it('no green→black gradient class is left on any button in apps/web/src', () => {
    // The retired ramp: FULL-strength brand-primary → brand-deep on one class list (the CTA and
    // icon-tile ramp). Opacity-tinted panels (/10 info boxes) and non-button gradients (hero
    // cards, scrims, chart fills) are out of the buttons-only ruling and excluded here.
    const offenders = listSources(SRC).filter((f) => {
      if (f.endsWith('pill-button.test.ts')) return false;
      const src = readFileSync(f, 'utf8');
      return /bg-gradient-to-\w+ from-brand-primary(?![/\d])[^"']*to-brand-deep(?![/\d])/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
