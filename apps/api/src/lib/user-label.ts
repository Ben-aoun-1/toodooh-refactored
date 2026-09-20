import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';

// ADM-FIX1 — the ONE display label for a platform user. The admin surfaces (campaign queue,
// creative moderation) used to print a raw uuid where an operator expects a name; every payload
// that carries a user id now carries this label beside it.
//
// The rule is `coalesce(business_name, contact_name)` with one refinement: an EMPTY business_name
// (the signup keeps the column nullable, and a blank string survives a trimmed-away input) would
// render as nothing, so it falls through to the contact name the same way NULL does.

export interface UserLabelSource {
  businessName: string | null;
  contactName: string;
}

export const userLabel = (user: UserLabelSource): string => {
  const business = user.businessName?.trim() ?? '';
  return business.length > 0 ? business : user.contactName;
};

/**
 * The label for ONE user id, for the moderation responses that update-and-return a row and so have
 * no join to ride on. Falls back to the id itself — a response never carries an empty label.
 */
export const userLabelById = async (userId: string): Promise<string> => {
  const [row] = await db
    .select({ businessName: users.businessName, contactName: users.contactName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? userLabel(row) : userId;
};
