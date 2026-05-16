import { QueryClient } from '@tanstack/react-query';

/**
 * Step 10 — server-state layer.
 *
 * Single source of `QueryClient` configuration for `apps/web`. The defaults
 * below are locked decision D-Q (see
 * `docs/superpowers/plans/2026-05-17-step-10-react-query.md`):
 *
 * - `staleTime: 30s`           — most TOODOOH data is not real-time; a 30s
 *                                window avoids refetch storms while keeping
 *                                views reasonably fresh.
 * - `gcTime: 5min`             — the React Query v5 default; unreferenced
 *                                query caches are collected after 5 minutes.
 * - `refetchOnWindowFocus`     — false; the app is a dashboard, not a feed.
 *                                Focus-refetch would flicker money figures.
 *                                (Post-Step-10 revisit candidate — with the
 *                                30s staleTime in place, flipping to true is
 *                                low-risk.)
 * - `retry: 1`                 — one retry, then surface the error.
 *
 * A hook that genuinely needs different behaviour sets it per-`useQuery`,
 * with a comment naming why.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
