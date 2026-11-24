import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, logos, notifications, screenhosts, users } from '../src/db/schema.js';
import { decideLogo, logoFileCheck, logosFor, pendingLogos, submitLogo } from '../src/lib/logos.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Agent specs VF « Logos » on a real Postgres + storage: an agent's logo waits for an admin and
// is shown to him alone meanwhile; the owner's and the admin's are validated at once; one
// validated and one pending logo per subject.

const png = (w: number, h: number) => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

let seq = 0;
const seedUser = async (values: Partial<NewUser>): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `logo-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const setup = async () => {
  const admin = await seedUser({ role: 'admin', contactName: 'Admin' });
  const agent = await seedUser({ role: 'screenhost_agent', contactName: 'Amine Agent' });
  const other = await seedUser({ role: 'screenhost_agent', contactName: 'Autre Agent' });
  const owner = await seedUser({ role: 'individual_owner', businessName: 'Café Nord SARL' });
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: 'Café Nord', ownerId: owner })
    .returning();
  return {
    admin,
    agent,
    other,
    owner,
    venue: { kind: 'screenhost' as const, id: venue?.id ?? '' },
  };
};

const statuses = async (venueId: string) =>
  (await db.select().from(logos).where(eq(logos.screenhostId, venueId)))
    .map((l) => l.status)
    .sort();

describe('logos', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('accepts PNG or JPEG of 400 × 400 px at least', () => {
    expect(logoFileCheck(png(400, 400))).toEqual({ ok: true, contentType: 'image/png' });
    expect(logoFileCheck(png(399, 800))).toEqual({ ok: false, error: 'LOGO_TOO_SMALL' });
    expect(logoFileCheck(Buffer.from('%PDF-1.4'))).toEqual({
      ok: false,
      error: 'UNSUPPORTED_FILE',
    });
  });

  it('an agent’s logo is pending: he sees it, nobody else does, the admins are told', async () => {
    const s = await setup();
    const sent = await submitLogo(s.venue, png(500, 500), { userId: s.agent, role: 'agent' });
    expect(sent).toMatchObject({ ok: true, logo: { status: 'en_attente' } });
    expect((await logosFor([s.venue], s.agent)).get(s.venue.id)?.status).toBe('en_attente');
    expect((await logosFor([s.venue], s.other)).get(s.venue.id)).toBeUndefined();
    expect((await logosFor([s.venue], null)).get(s.venue.id)).toBeUndefined();
    const [notice] = await db.select().from(notifications).where(eq(notifications.userId, s.admin));
    expect(notice).toMatchObject({
      type: 'admin_logo_pending',
      title: 'Logo à valider : Café Nord',
    });
    const queue = await pendingLogos();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ subject_name: 'Café Nord', agent_name: 'Amine Agent' });
    // A second upload replaces the pending one (one pending logo per subject).
    await submitLogo(s.venue, png(600, 600), { userId: s.agent, role: 'agent' });
    expect(await statuses(s.venue.id)).toEqual(['en_attente', 'remplace']);
  });

  it('validation makes it THE logo and tells the agent; a decision is final', async () => {
    const s = await setup();
    await submitLogo(s.venue, png(500, 500), { userId: s.owner, role: 'owner' });
    expect((await logosFor([s.venue], null)).get(s.venue.id)?.status).toBe('valide');
    const sent = await submitLogo(s.venue, png(500, 500), { userId: s.agent, role: 'agent' });
    if (!sent.ok) throw new Error('upload failed');
    // The validated logo stays the one everybody sees while the agent's waits.
    expect(await statuses(s.venue.id)).toEqual(['en_attente', 'valide']);
    expect((await logosFor([s.venue], s.other)).get(s.venue.id)?.status).toBe('valide');
    expect(await decideLogo(sent.logo.id, s.admin, true, null)).toMatchObject({ ok: true });
    expect(await statuses(s.venue.id)).toEqual(['remplace', 'valide']);
    expect(await decideLogo(sent.logo.id, s.admin, false, 'non')).toEqual({
      ok: false,
      error: 'ALREADY_DECIDED',
    });
    const agentNotices = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, s.agent));
    expect(agentNotices.map((n) => n.title)).toEqual(['Logo validé : Café Nord']);
  });

  it('a refusal keeps the current logo and gives the agent the reason', async () => {
    const s = await setup();
    const sent = await submitLogo(s.venue, png(500, 500), { userId: s.agent, role: 'agent' });
    if (!sent.ok) throw new Error('upload failed');
    expect(await decideLogo(sent.logo.id, s.admin, false, 'Logo flou')).toMatchObject({ ok: true });
    expect((await logosFor([s.venue], s.agent)).get(s.venue.id)).toBeUndefined();
    const [n] = await db.select().from(notifications).where(eq(notifications.userId, s.agent));
    expect(n).toMatchObject({ title: 'Logo refusé : Café Nord', body: 'Logo flou' });
    // An admin's own upload is validated at once.
    await submitLogo(s.venue, png(500, 500), { userId: s.admin, role: 'admin' });
    expect((await logosFor([s.venue], null)).get(s.venue.id)?.status).toBe('valide');
  });
});
