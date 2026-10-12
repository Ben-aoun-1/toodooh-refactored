import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS } from '@/lib/feature-flags';

import { CATEGORIES_LOCKED_LINE, allNetworkLine, isAllNetwork } from './lib/targeting-lines';

// Flag campaignCategoriesLocked (operator 2026-10-12): in campaign creation every category shows
// selected and none can be unselected. apps/web has no render harness — the wiring is source-pinned.

const read = (...p: string[]): string =>
  readFileSync(join(__dirname, ...p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

describe('campaign categories locked (flag)', () => {
  it('is ON', () => {
    expect(FEATURE_FLAGS.campaignCategoriesLocked).toBe(true);
  });

  it('the panel seeds the whole-network line under the flag (a narrower draft is rewritten)', () => {
    const panel = read('components', 'CampaignTargetingPanel.tsx');
    expect(panel).toContain('FEATURE_FLAGS.campaignCategoriesLocked');
    expect(panel).toContain('[newBuilderLine(allNetworkLine())]');
    expect(panel).toContain('locked={FEATURE_FLAGS.campaignCategoriesLocked}');
    expect(isAllNetwork(allNetworkLine())).toBe(true);
  });

  it('the builder shows every category checked and disables every control when locked', () => {
    const builder = read('components', 'TargetingBuilder.tsx');
    expect(builder).toContain('const disabled = disabledProp || locked;');
    expect(builder).toContain('const checked = locked || ');
    expect(builder).toContain('CATEGORIES_LOCKED_LINE');
    expect(CATEGORIES_LOCKED_LINE).toContain('Toutes les catégories');
  });
});
