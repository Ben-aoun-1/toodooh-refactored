import { screenhosts } from '../db/schema.js';

// Single source of truth for the wire(snake_case) → drizzle-column mapping of a screenhost's
// L-inv eligibility inputs. Used by the admin PATCH (apps/api/src/routes/screenhosts.ts) AND the
// wedooh eligibility ingest (apps/api/src/routes/internal.ts) so both sides write the same columns.
// PARTIAL semantics: only keys that are present (!== undefined) are written — an OMITTED field is
// left UNCHANGED, an explicit null CLEARS it. This is what lets the hub push the fields it owns
// (category + class) without clobbering admin-set fields (hours/capacity) it does not.
export interface EligibilityPatchInput {
  business_sector_id?: string | null;
  class?: 'populaire' | 'moyen' | 'premium' | null;
  opening_hour?: number | null;
  closing_hour?: number | null;
  broadcast_capacity?: number | null;
}

export const buildEligibilityPatch = (
  data: EligibilityPatchInput,
): Partial<typeof screenhosts.$inferInsert> => {
  const patch: Partial<typeof screenhosts.$inferInsert> = {};
  if (data.business_sector_id !== undefined) patch.businessSectorId = data.business_sector_id;
  if (data.class !== undefined) patch.class = data.class;
  if (data.opening_hour !== undefined) patch.openingHour = data.opening_hour;
  if (data.closing_hour !== undefined) patch.closingHour = data.closing_hour;
  if (data.broadcast_capacity !== undefined) patch.broadcastCapacity = data.broadcast_capacity;
  return patch;
};
