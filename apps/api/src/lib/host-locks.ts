import type { EligibilityPatchInput } from './eligibility-patch.js';

// HOST-EDIT1 (ruling Q5 B, 2026-10-25) — an eligibility field an ADMIN set by hand is LOCKED: the
// hub's C3 ingest (POST /api/internal/screenhost-eligibility) may no longer overwrite it. Stored in
// screenhosts.admin_locked_fields. The hours pair locks as ONE key — half a window from the hub
// over half from the admin would be a window nobody chose. The owner's own hours editor is NOT
// gated: the lock is against the hub only. The admin « Rendre au hub » action removes a key.
export const HOST_LOCK_KEYS = ['business_sector', 'class', 'hours', 'broadcast_capacity'] as const;
export type HostLockKey = (typeof HOST_LOCK_KEYS)[number];

export const isHostLockKey = (value: string): value is HostLockKey =>
  (HOST_LOCK_KEYS as readonly string[]).includes(value);

export interface EligibilityValues {
  business_sector_id: string | null;
  class: string | null;
  opening_hour: number | null;
  closing_hour: number | null;
  broadcast_capacity: number | null;
}

/** The lock keys whose value an admin edit actually CHANGED (a re-save of the same value locks nothing). */
export const changedLockKeys = (
  before: EligibilityValues,
  after: EligibilityValues,
): HostLockKey[] => {
  const keys: HostLockKey[] = [];
  if (before.business_sector_id !== after.business_sector_id) keys.push('business_sector');
  if (before.class !== after.class) keys.push('class');
  if (before.opening_hour !== after.opening_hour || before.closing_hour !== after.closing_hour) {
    keys.push('hours');
  }
  if (before.broadcast_capacity !== after.broadcast_capacity) keys.push('broadcast_capacity');
  return keys;
};

/** The stored set plus the new keys, deduplicated, in HOST_LOCK_KEYS order. */
export const mergeLocks = (
  stored: readonly string[],
  added: readonly HostLockKey[],
): HostLockKey[] => HOST_LOCK_KEYS.filter((k) => stored.includes(k) || added.includes(k));

/** The hub's patch with every locked field dropped (omitted = left unchanged). */
export const withoutLockedFields = (
  input: EligibilityPatchInput,
  locked: readonly string[],
): EligibilityPatchInput => {
  const out: EligibilityPatchInput = { ...input };
  if (locked.includes('business_sector')) delete out.business_sector_id;
  if (locked.includes('class')) delete out.class;
  if (locked.includes('hours')) {
    delete out.opening_hour;
    delete out.closing_hour;
  }
  if (locked.includes('broadcast_capacity')) delete out.broadcast_capacity;
  return out;
};
