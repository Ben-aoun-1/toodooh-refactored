import { db } from '../../src/db/client.js';
import { type NewUser, users } from '../../src/db/schema.js';

// ELIG-2 (operator ruling 2026-09-16) — only a venue whose owner is APPROVED is eligible anywhere
// (pool, C_max, cascade, redispatch, event pool/ceiling, coverage map, « Hosts éligibles »). A
// fixture venue that must count therefore needs an approved owner: `users.status` defaults to
// 'pending', and an ownerless venue is out as well.
//
// THE fixture for it. A test about something else seeds its venue as
//
//   ownerId: await seedApprovedOwner(),
//
// and a test that needs a specific owner row passes overrides (role, status, email…). The email
// is uuid-suffixed so it never collides with a file's own `seedUser` counter; the row goes with
// resetAuthTables like every user.

export const seedApprovedOwner = async (values: Partial<NewUser> = {}): Promise<string> => {
  const tag = crypto.randomUUID();
  const [row] = await db
    .insert(users)
    .values({
      email: `approved-owner-${tag}@example.com`,
      contactName: `Propriétaire ${tag.slice(0, 8)}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('seedApprovedOwner: the insert returned no row');
  return row.id;
};
