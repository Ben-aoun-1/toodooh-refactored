import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// FCT1 — the two source-pinned riders (the third, the /apptv version line, is pinned in
// features/apptv/lib/apptv.test.ts). Source pins, the App.tsx-route idiom: no render harness
// exists, so the load-bearing guards are asserted against the component source.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('rider (b) — the NULL mime_type white-screen guard', () => {
  it('CreativeView.mime_type is honestly nullable (backfilled prod rows carry no mime)', () => {
    const source = read('../../campaigns/services/creatives.api.ts');
    expect(source).toContain('mime_type: string | null;');
  });

  it('CampaignReviewQueue guards the startsWith (a mime-less creative renders, never crashes)', () => {
    const source = read('../pages/CampaignReviewQueue.tsx');
    expect(source).toContain("mime_type?.startsWith('video/')");
    expect(source).not.toContain("mime_type.startsWith('video/')");
  });

  it('CreativeManagement carries the same guard (the type widening forced it)', () => {
    const source = read('../pages/CreativeManagement.tsx');
    expect(source).toContain("mime_type?.startsWith('video/')");
    expect(source).not.toContain("mime_type.startsWith('video/')");
  });
});

describe('rider (c) — the EL1 « Incomplet » badge no longer crushes the venue name', () => {
  it('the card header wraps (the badge drops to its own line on narrow cards)', () => {
    const source = read('../components/ScreenhostEligibilityCard.tsx');
    const headerStart = source.indexOf('flex flex-wrap items-center justify-between');
    expect(headerStart).toBeGreaterThan(-1);
    // The name keeps its truncate + min-w-0; the badge caps at the card width.
    expect(source).toContain('max-w-full truncate');
  });
});
