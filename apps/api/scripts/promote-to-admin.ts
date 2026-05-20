import { eq } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

const email = process.argv[2];

const run = async (): Promise<void> => {
  if (!email) {
    console.error('usage: pnpm --filter @toodooh/api promote <email>');
    process.exit(1);
  }
  const updated = await db
    .update(users)
    .set({ role: 'superadmin' })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email, role: users.role });
  const [row] = updated;
  if (!row) {
    console.error(`no user found with email ${email}`);
    process.exit(1);
  }
  console.info(`promoted ${row.email} → ${row.role}`);
};

run()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('promote failed', err);
    await sql.end();
    process.exit(1);
  });
