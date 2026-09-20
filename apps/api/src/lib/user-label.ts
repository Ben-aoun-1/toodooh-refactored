import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';

// ADM-FIX1 — the ONE display label for a platform user. The admin surfaces (campaign queue,
// creative moderation) used to print a raw uuid where an operator expects a name; every payload
// that carries a user id now carries this label beside it.
//
// The rule is `coalesce(business_name, contact_name, email, id)`. business_name and contact_name
// are both trimmed before the check (the signup keeps business_name nullable, and either column
// can survive as a blank string) so a blank one falls through the same way NULL does. Review round
// fix — the guard used to be one-sided: a NULL business_name with a blank contact_name fell all the
// way through to an EMPTY label. email (NOT NULL + unique) and finally the caller's own id close
// every remaining gap — this never returns an empty string.

export interface UserLabelSource {
  id: string;
  businessName: string | null;
  contactName: string;
  email: string;
}

export const userLabel = (user: UserLabelSource): string => {
  const business = user.businessName?.trim() ?? '';
  if (business.length > 0) return business;
  const contact = user.contactName.trim();
  if (contact.length > 0) return contact;
  const email = user.email.trim();
  if (email.length > 0) return email;
  return user.id;
};

/**
 * The label for ONE user id, for the moderation responses that update-and-return a row and so have
 * no join to ride on. Falls back to the id itself — a response never carries an empty label.
 */
export const userLabelById = async (userId: string): Promise<string> => {
  const [row] = await db
    .select({
      businessName: users.businessName,
      contactName: users.contactName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? userLabel({ id: userId, ...row }) : userId;
};
