import { describe, expect, it } from 'vitest';

import { shouldAutoOpen } from './popover-auto-open';

// GREEN2 item 9 — auto-open at most once per session; content alone never re-triggers it.
describe('shouldAutoOpen', () => {
  it('opens on first content, never again once consumed', () => {
    expect(shouldAutoOpen(true, false)).toBe(true);
    expect(shouldAutoOpen(true, true)).toBe(false);
  });

  it('no content never opens, consumed or not', () => {
    expect(shouldAutoOpen(false, false)).toBe(false);
    expect(shouldAutoOpen(false, true)).toBe(false);
  });
});
