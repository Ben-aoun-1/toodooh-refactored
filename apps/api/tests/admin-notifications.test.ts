import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, notifications, users } from '../src/db/schema.js';
import { accountLabel, adminFanout, notifyAdmins } from '../src/lib/admin-notifications.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// ADM-BELL1 / RECH-N1 — the admin fan-out: one row per admin/superadmin, none when no admin exists.
let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `adm${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('admin notifications fan-out', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('adminFanout is pure: one row per admin id, campaignId defaults to null', () => {
    const rows = adminFanout({ type: 'admin_campaign_pending', title: 'T', body: 'B' }, [
      'a1',
      'a2',
    ]);
    expect(rows).toEqual([
      { userId: 'a1', type: 'admin_campaign_pending', title: 'T', body: 'B', campaignId: null },
      { userId: 'a2', type: 'admin_campaign_pending', title: 'T', body: 'B', campaignId: null },
    ]);
    expect(adminFanout({ type: 'admin_account_pending', title: 'T', body: 'B' }, [])).toEqual([]);
  });

  it('notifyAdmins inserts for every admin AND superadmin, never for other roles', async () => {
    const admin = await seedUser({ role: 'admin' });
    const superadmin = await seedUser({ role: 'superadmin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const n = await notifyAdmins(db, {
      type: 'admin_account_pending',
      title: 'Nouveau compte à valider',
      body: 'Le compte « X » attend votre validation.',
    });
    expect(n).toBe(2);
    for (const id of [admin, superadmin]) {
      const rows = await db.select().from(notifications).where(eq(notifications.userId, id));
      expect(rows.map((r) => r.type)).toEqual(['admin_account_pending']);
    }
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, advertiser)),
    ).toEqual([]);
  });

  it('with no admin at all, notifyAdmins inserts nothing and returns 0', async () => {
    await seedUser({ role: 'advertiser' });
    expect(await notifyAdmins(db, { type: 'admin_creative_pending', title: 'T', body: 'B' })).toBe(
      0,
    );
    expect(await db.select().from(notifications)).toEqual([]);
  });

  it('accountLabel prefers the business name, then the contact name', async () => {
    const withBiz = await seedUser({ businessName: 'Société Horizon', contactName: 'Amine' });
    const noBiz = await seedUser({ contactName: 'Mariem' });
    expect(await accountLabel(withBiz)).toBe('Société Horizon');
    expect(await accountLabel(noBiz)).toBe('Mariem');
  });
});
