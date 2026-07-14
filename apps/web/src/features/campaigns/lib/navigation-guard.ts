// CF-W1 (spec §1.9) — in-app navigation guard. The app runs a component BrowserRouter (no data
// router), so react-router's useBlocker is UNAVAILABLE; blocking works by CONSULTATION instead:
// programmatic navigation sources ask the registry before navigating (today: the advertiser
// sidebar — the wizard's own exits are wired directly). One guard at a time (the wizard); a
// guard returning false takes over the exit (it opens the confirm popup and later navigates
// itself). Registration returns an unregister function that only clears ITS OWN guard.

type NavigationGuard = (to: string) => boolean;

let activeGuard: NavigationGuard | null = null;

/** Register the active guard; returns the matching unregister (stale unregisters are no-ops). */
export function setNavigationGuard(guard: NavigationGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/** True = proceed with the navigation; false = blocked (the guard has taken over). */
export function consultNavigationGuard(to: string): boolean {
  return activeGuard ? activeGuard(to) : true;
}
