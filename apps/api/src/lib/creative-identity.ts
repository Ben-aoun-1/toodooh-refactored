import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { creatives } from '../db/schema.js';

// CF-SK1 (spec §2.1, ruling #9) — a spot's IDENTITY is its file hash. « Si le spot est une vidéo
// déjà diffusée précédemment, ma validation n'est pas nécessaire » — so a re-upload of bytes the
// admin ALREADY approved (for the SAME owner) is born approved and never re-enters the queue; a
// modified file hashes differently, so it is a NEW spot and gets reviewed. sha256 via node:crypto
// (no new dependency).

/** sha256 of the uploaded bytes, hex — the spot's identity. */
export const hashCreativeBytes = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

export interface InheritedApproval {
  /** The prior APPROVED creative these exact bytes were already cleared as. */
  sourceCreativeId: string;
}

/**
 * The prior APPROVED creative with these exact bytes for THIS owner, or null.
 *
 * Cross-owner inheritance is FORBIDDEN: an approval is a judgement about one advertiser's use of
 * one file (rights, context, the account behind it). Advertiser B uploading bytes that advertiser
 * A had approved must still be reviewed — otherwise an approval leaks across accounts and anyone
 * could bypass moderation by obtaining an already-cleared file. Hence the (advertiser_id, hash)
 * lookup, never hash alone.
 *
 * Only APPROVED inherits: a rejected (or still-pending) original carries no clearance to pass on.
 * A NULL hash (legacy rows, pre-0048) never matches — SQL equality on NULL is never true, and the
 * caller only ever passes a freshly computed hash.
 */
export const findInheritableApproval = async (
  advertiserId: string,
  fileHash: string,
): Promise<InheritedApproval | null> => {
  const [prior] = await db
    .select({ id: creatives.id })
    .from(creatives)
    .where(
      and(
        eq(creatives.advertiserId, advertiserId),
        eq(creatives.fileHash, fileHash),
        eq(creatives.validationStatus, 'approved'),
      ),
    )
    .limit(1);
  return prior ? { sourceCreativeId: prior.id } : null;
};

/** The moderation-trail note stamped on an inherited approval (French — the admin surface reads it). */
export const inheritedApprovalNote = (sourceCreativeId: string): string =>
  `Validation héritée de ${sourceCreativeId} (mêmes fichiers, même annonceur).`;
