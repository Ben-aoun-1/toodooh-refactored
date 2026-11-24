import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, agents, screenhosts, users } from '../src/db/schema.js';
import { createChecklist, saveChecklist, sendChecklist } from '../src/lib/agent-checklists.js';
import {
  adminChecklist,
  adminChecklists,
  checklistOfScreenhost,
  linkChecklist,
} from '../src/lib/checklist-links.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Mariem 15/11/2026 — the Admin links a sent fiche to the Screenhost it became; a Screenhost
// carries one fiche; drafts are never listed nor linkable; the Fiche Host reads the link.

const complete = {
  nom: 'Café Nord',
  categorie: 'Cafés',
  gouvernorat: 'Tunis',
  quartier: 'La Marsa',
  o_date: '2026-11-15',
  o_heure: '10:30',
  affluence: 'moins',
  avis: 'non',
  avis_com: 'Trop calme',
  action: 'abandon',
};

let seq = 0;
const seedUser = async (role: NewUser['role']): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `lnk-${seq}@example.com`, contactName: `U${seq}`, status: 'approved', role })
    .returning();
  return u?.id ?? '';
};
const seedAgent = async (): Promise<string> => {
  const id = await seedUser('screenhost_agent');
  await db.insert(agents).values({ userId: id, code: `SH${400000 + seq}`, accountStatus: 'actif' });
  return id;
};
const seedVenue = async (name: string): Promise<string> => {
  const owner = await seedUser('individual_owner');
  const [v] = await db.insert(screenhosts).values({ name, ownerId: owner }).returning();
  return v?.id ?? '';
};
const sentFiche = async (agent: string): Promise<string> => {
  const { id } = await createChecklist(agent);
  await saveChecklist(agent, id, complete);
  const r = await sendChecklist(agent, id);
  if (!r.ok) throw new Error('fiche not sent');
  return id;
};

describe('admin links a fiche to its Screenhost', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a sent fiche is listed unlinked, then linked, then read on the Fiche Host', async () => {
    const agent = await seedAgent();
    const id = await sentFiche(agent);
    const draft = await createChecklist(agent);
    const venue = await seedVenue('Café Nord');

    const before = await adminChecklists();
    expect(before.map((r) => r.id)).toEqual([id]);
    expect(before[0]?.screenhost).toBeNull();
    expect(await linkChecklist(draft.id, venue)).toEqual({ ok: false, error: 'NOT_FOUND' });

    expect(await linkChecklist(id, venue)).toEqual({ ok: true });
    expect((await adminChecklists())[0]?.screenhost).toEqual({ id: venue, name: 'Café Nord' });
    expect((await adminChecklist(id))?.screenhost).toEqual({ id: venue, name: 'Café Nord' });
    expect((await checklistOfScreenhost(venue))?.id).toBe(id);

    expect(await linkChecklist(id, null)).toEqual({ ok: true });
    expect(await checklistOfScreenhost(venue)).toBeNull();
  });

  it('a Screenhost carries one fiche; an unknown Screenhost is refused', async () => {
    const agent = await seedAgent();
    const a = await sentFiche(agent);
    const b = await sentFiche(agent);
    const venue = await seedVenue('Café Sud');
    expect(await linkChecklist(a, venue)).toEqual({ ok: true });
    expect(await linkChecklist(b, venue)).toEqual({ ok: false, error: 'SCREENHOST_TAKEN' });
    expect(await linkChecklist(a, venue)).toEqual({ ok: true });
    expect(await linkChecklist(b, '00000000-0000-4000-8000-000000000000')).toEqual({
      ok: false,
      error: 'SCREENHOST_NOT_FOUND',
    });
  });
});
