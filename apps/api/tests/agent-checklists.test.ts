import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, agentChecklists, agents, notifications, users } from '../src/db/schema.js';
import {
  createChecklist,
  decideChecklist,
  hubChecklist,
  hubChecklists,
  myChecklist,
  myChecklists,
  saveChecklist,
  sendChecklist,
} from '../src/lib/agent-checklists.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Agent Screenhost spec VF §11 on a real Postgres: a draft is the agent's own and is saved as he
// types; sending needs every answer and freezes the result computed here; the manager's decision
// is written once and is final.

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
const seedAgent = async (name: string): Promise<string> => {
  seq += 1;
  const values: NewUser = {
    email: `chk-${seq}@example.com`,
    contactName: name,
    status: 'approved',
    role: 'screenhost_agent',
  };
  const [u] = await db.insert(users).values(values).returning();
  await db
    .insert(agents)
    .values({ userId: u?.id ?? '', code: `SH${300000 + seq}`, accountStatus: 'actif' });
  return u?.id ?? '';
};
const MANAGER = { hub_user_id: 7, name: 'Mona Manager' };

describe('agent checklists', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a draft is saved as typed, keeps the Wi-Fi password encrypted, and belongs to its agent', async () => {
    const agent = await seedAgent('Amine Agent');
    const other = await seedAgent('Autre Agent');
    const { id } = await createChecklist(agent);
    expect(
      await saveChecklist(agent, id, {
        nom: '  Café Nord ',
        wifi_mdp: 'pass1234',
        hack: 'x',
        jours: ['Lundi', 3],
      }),
    ).toEqual({ ok: true });
    const [row] = await db.select().from(agentChecklists).where(eq(agentChecklists.id, id));
    expect(row?.answers).toEqual({ nom: 'Café Nord', jours: ['Lundi'] });
    expect(row?.wifiPasswordEncrypted).toBeTruthy();
    expect(row?.wifiPasswordEncrypted).not.toContain('pass1234');
    expect((await myChecklist(agent, id))?.answers).toMatchObject({
      nom: 'Café Nord',
      wifi_mdp: 'pass1234',
    });
    expect((await myChecklists(agent))[0]).toMatchObject({
      status: 'draft',
      name: 'Café Nord',
      result: null,
    });
    // Another agent neither reads nor writes it.
    expect(await myChecklist(other, id)).toBeNull();
    expect(await saveChecklist(other, id, { nom: 'Volé' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(await hubChecklists('all')).toEqual([]);
    expect(await hubChecklist(id)).toBeNull();
  });

  it('sending needs every answer; the result is computed here and the fiche is then frozen', async () => {
    const agent = await seedAgent('Amine Agent');
    const { id } = await createChecklist(agent);
    await saveChecklist(agent, id, { ...complete, avis: undefined });
    expect(await sendChecklist(agent, id)).toEqual({
      ok: false,
      error: 'INCOMPLETE',
      question: 'avis',
    });
    await saveChecklist(agent, id, complete);
    const sent = await sendChecklist(agent, id);
    expect(sent).toMatchObject({
      ok: true,
      checklist: { status: 'sent', result: 'non', agentName: 'Amine Agent' },
    });
    expect(await saveChecklist(agent, id, { ...complete, affluence: 'plus' })).toEqual({
      ok: false,
      error: 'NOT_A_DRAFT',
    });
    expect(await sendChecklist(agent, id)).toEqual({ ok: false, error: 'NOT_A_DRAFT' });
    const hub = await hubChecklist(id);
    expect(hub).toMatchObject({
      name: 'Café Nord',
      governorate: 'Tunis',
      delegation: 'La Marsa',
      result: 'non',
      agent_opinion: 'non',
      agent_comment: 'Trop calme',
      status: 'sent',
      result_detail: { motifs: ['Affluence inférieure à 20 personnes en moyenne'] },
    });
    expect(hub?.pages.map((p) => p.title)).toEqual([
      "L'établissement",
      'Ton observation',
      'Ton avis',
      'La prochaine action',
    ]);
    expect(await hubChecklists('decided')).toEqual([]);
  });

  it('the manager decides once: the agent is told, a second different decision is refused', async () => {
    const agent = await seedAgent('Amine Agent');
    const { id } = await createChecklist(agent);
    await saveChecklist(agent, id, complete);
    // A draft cannot be decided.
    expect(await decideChecklist(id, 'validated', null, MANAGER)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    await sendChecklist(agent, id);
    const first = await decideChecklist(id, 'refused', 'Pas assez de passage', MANAGER);
    expect(first).toMatchObject({
      ok: true,
      checklist: {
        status: 'refused',
        decided_by_name: 'Mona Manager',
        manager_comment: 'Pas assez de passage',
      },
    });
    expect(await decideChecklist(id, 'refused', null, MANAGER)).toMatchObject({ ok: true });
    expect(await decideChecklist(id, 'validated', null, MANAGER)).toEqual({
      ok: false,
      error: 'ALREADY_DECIDED',
    });
    const notes = await db.select().from(notifications).where(eq(notifications.userId, agent));
    expect(notes.map((n) => [n.type, n.title, n.body])).toEqual([
      [
        'agent_checklist_refused',
        'Fiche refusée par le manager : Café Nord',
        'Pas assez de passage',
      ],
    ]);
    expect((await myChecklists(agent))[0]).toMatchObject({ status: 'refused', result: 'non' });
    expect((await hubChecklists('decided')).map((c) => c.id)).toEqual([id]);
  });
});
