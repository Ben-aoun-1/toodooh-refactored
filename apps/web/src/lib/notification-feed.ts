/**
 * Shared shape + optimistic-update helper for the two notification bells
 * (Step 10, Commit 8 — the D5 scoped exception).
 *
 * Both the advertiser and the screen-host bell run on React Query: one
 * `useQuery` whose payload is a `NotificationFeed`, and one mark-read
 * `useMutation` with `onMutate`/`onError` optimistic rollback. The cache
 * transform that rollback hinges on is this pure `markFeedRead` — extracted
 * so the apply/keep/revert behaviour is unit-tested once (D-T option A) and
 * shared rather than duplicated per bell.
 *
 * Notification items are stored *serializable* — an `actionPath` string, not
 * an `action` closure: a `useQuery` `queryFn` is a plain async function and
 * cannot capture the `useNavigate` closure the former inline bells built. The
 * bell component turns `actionPath` into navigation at click time.
 */
export interface NotificationFeedItem<K extends string = string> {
  id: string;
  kind: K;
  title: string;
  timestamp: Date;
  actionLabel: string;
  actionPath: string;
}

export interface NotificationFeed<K extends string = string> {
  items: NotificationFeedItem<K>[];
  /** IDs marked read — stored as a plain array (cache-serializable). */
  readIds: string[];
}

/**
 * Returns a new feed with `ids` added to `readIds` (deduplicated). Pure — the
 * optimistic `onMutate` applies it, `onError` restores the pre-mutation
 * snapshot, so a failed mark-read never leaves the bell falsely cleared.
 *
 * The constraint is any `readIds`-bearing feed (CF-S1b): the advertiser feed's
 * items carry a nullable CTA so they are not `NotificationFeedItem`s, but the
 * mark-read transform only ever touches `readIds`.
 */
export function markFeedRead<F extends { readIds: string[] }>(feed: F, ids: readonly string[]): F {
  const merged = new Set(feed.readIds);
  for (const id of ids) merged.add(id);
  return { ...feed, readIds: [...merged] };
}
