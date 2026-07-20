import { describe, expect, it } from 'vitest';

import { reconcileAutofill } from './autofill-sync';

// The DOM-sync seam (prod-blocker lane): whenever the browser's input.value differs from React
// state — mobile autofill that never dispatched a React-visible event — the DOM wins.
describe('reconcileAutofill', () => {
  it('DOM values that differ replace state (the silent-autofill repro)', () => {
    const state = { email: '', phone: '+216' };
    const dom = { email: 'auto@filled.tn', phone: '+216 22 333 444' };
    const { next, changedKeys } = reconcileAutofill(state, dom);
    expect(next).toEqual({ email: 'auto@filled.tn', phone: '+216 22 333 444' });
    expect(changedKeys).toEqual(['email', 'phone']);
  });

  it('in-sync values change nothing (typed input keeps its exact state)', () => {
    const state = { email: 'a@b.tn', phone: '+21622333444' };
    const { next, changedKeys } = reconcileAutofill(state, { ...state });
    expect(next).toEqual(state);
    expect(changedKeys).toEqual([]);
  });

  it('undefined DOM reads (input not mounted) are skipped, never clearing state', () => {
    const state = { email: 'a@b.tn', phone: '+21622333444' };
    const { next, changedKeys } = reconcileAutofill(state, { email: undefined, phone: undefined });
    expect(next).toEqual(state);
    expect(changedKeys).toEqual([]);
  });

  it('an EMPTY DOM value wins over filled state — the DOM is what the user sees', () => {
    const state = { email: 'stale@state.tn' };
    const { next, changedKeys } = reconcileAutofill(state, { email: '' });
    expect(next.email).toBe('');
    expect(changedKeys).toEqual(['email']);
  });

  it('never mutates the input state object', () => {
    const state = { email: '' };
    reconcileAutofill(state, { email: 'x@y.tn' });
    expect(state.email).toBe('');
  });
});
