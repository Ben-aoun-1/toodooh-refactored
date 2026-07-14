import { afterEach, describe, expect, it, vi } from 'vitest';

import { consultNavigationGuard, setNavigationGuard } from './navigation-guard';

// CF-W1 §1.9 — the consultation registry that stands in for useBlocker (component BrowserRouter:
// no data router in the app). One guard at a time; stale unregisters never clobber a newer guard.

describe('navigation-guard registry', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('passes through when no guard is registered', () => {
    expect(consultNavigationGuard('/my-campaigns')).toBe(true);
  });

  it('consults the registered guard with the destination and honors its verdict', () => {
    const guard = vi.fn().mockReturnValue(false);
    cleanup = setNavigationGuard(guard);
    expect(consultNavigationGuard('/dashboard')).toBe(false);
    expect(guard).toHaveBeenCalledWith('/dashboard');
    guard.mockReturnValue(true);
    expect(consultNavigationGuard('/dashboard')).toBe(true);
  });

  it('unregister clears the guard (no orphan blockers)', () => {
    const unregister = setNavigationGuard(() => false);
    unregister();
    expect(consultNavigationGuard('/anywhere')).toBe(true);
  });

  it('a STALE unregister never clobbers a newer guard', () => {
    const unregisterOld = setNavigationGuard(() => true);
    const newGuard = vi.fn().mockReturnValue(false);
    cleanup = setNavigationGuard(newGuard);
    unregisterOld(); // stale — must be a no-op
    expect(consultNavigationGuard('/x')).toBe(false);
    expect(newGuard).toHaveBeenCalled();
  });
});
