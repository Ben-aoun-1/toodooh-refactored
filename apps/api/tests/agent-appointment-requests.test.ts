import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agentAppointments,
  agentUnavailableDays,
  agentUnavailableHours,
  agents,
  notifications,
  users,
} from '../src/db/schema.js';
import {
  ADMIN_RDV_TYPE,
  RDV_REQUEST_TYPE,
  affiliateAcceptRequest,
  affiliateProposeSlot,
  agentAcceptProposedSlot,
  agentRequestAppointment,
  noticeRdvCancelled,
  rdvTargets,
} from '../src/lib/agent-appointment-requests.js';
import {
  affiliateRespond,
  agentAccept,
  appointmentsOf,
  cancelAppointment,
} from '../src/lib/agent-appointments.js';
import { emailPath } from '../src/lib/agent-notifications.js';

import { seedLiveAffiliation } from './helpers/agent-affiliation.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// AGENT-VF (spec VF §13 / §9) — the agent's own rendez-vous request on a real Postgres: only his
// affiliates, the inverted round trip (the affiliate accepts or proposes, the agent accepts the
// new slot), and a notice to the Toodooh team at every step.

const NOW = new Date('2026-10-13T08:00:00Z');
const DAY = '2026-10-20';

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `rdv-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const setup = async () => {
  const admin = await seedUser({ role: 'admin', contactName: 'Admin' });
  const agent = await seedUser({ role: 'screencast_agent', contactName: 'Amine Agent' });
  await db
    .insert(agents)
    .values({ userId: agent, code: `SC${200000 + seq}`, accountStatus: 'actif' });
  const caster = await seedUser({ role: 'advertiser', businessName: 'Café Plus' });
  const stranger = await seedUser({ role: 'advertiser', businessName: 'Autre SARL' });
  await seedLiveAffiliation({ agentUserId: agent, referredUserId: caster });
  return { admin, agent, caster, stranger };
};

const request = (
  agent: string,
  targetId: string,
  over: Partial<{ hour: number; minute: number }> = {},
) =>
  agentRequestAppointment(
    agent,
    'screencast_agent',
    {
      targetId,
      day: DAY,
      hour: over.hour ?? 10,
      minute: over.minute ?? 30,
      place: 'telephone',
      subject: 'Point de suivi',
      message: null,
    },
    NOW,
  );

const noticesOf = async (userId: string) =>
  (await db.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => ({
    type: n.type,
    title: n.title,
  }));

describe('agent-initiated rendez-vous', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('lists only the agent’s live affiliates and refuses anyone else', async () => {
    const { agent, caster, stranger } = await setup();
    expect((await rdvTargets(agent, 'screencast_agent')).map((t) => t.id)).toEqual([caster]);
    expect(await request(agent, stranger)).toEqual({ ok: false, error: 'NOT_YOUR_AFFILIATE' });
    const bad = await agentRequestAppointment(
      agent,
      'screencast_agent',
      {
        targetId: caster,
        day: DAY,
        hour: 10,
        minute: 0,
        place: 'visio',
        subject: 'Visite de l’établissement',
        message: null,
      },
      NOW,
    );
    expect(bad).toEqual({ ok: false, error: 'BAD_SUBJECT' });
    expect(await request(agent, caster, { hour: 8 })).toMatchObject({ ok: true });
    const past = await agentRequestAppointment(
      agent,
      'screencast_agent',
      {
        targetId: caster,
        day: '2026-10-13',
        hour: 8,
        minute: 45,
        place: 'visio',
        subject: 'Autre',
        message: null,
      },
      NOW,
    );
    expect(past).toEqual({ ok: false, error: 'PAST_SLOT' });
  });

  it('the request tells the affiliate, the agent and the team; the affiliate accepts', async () => {
    const { admin, agent, caster } = await setup();
    const r = await request(agent, caster);
    if (!r.ok) throw new Error('request failed');
    expect(r.target).toBe('Café Plus');
    expect(await noticesOf(caster)).toEqual([
      {
        type: RDV_REQUEST_TYPE,
        title:
          'Amine Agent vous propose un rendez-vous le 20/10/2026 à 10h30 (Par téléphone) : Point de suivi',
      },
    ]);
    expect(await noticesOf(agent)).toEqual([
      { type: 'agent_appointment_sent', title: 'Demande de rendez-vous envoyée à Café Plus' },
    ]);
    expect((await noticesOf(admin)).map((n) => n.type)).toEqual([ADMIN_RDV_TYPE]);

    const [view] = await appointmentsOf('agent', agent, NOW);
    expect(view).toMatchObject({
      status: 'en_attente',
      initiated_by: 'agent',
      minute: 30,
      place: 'telephone',
      objective: 'Point de suivi',
    });
    // The agent cannot accept his own request, and the legacy affiliate answer does not apply.
    expect(await agentAccept(agent, r.appointment.id)).toEqual({ ok: false, error: 'BAD_STATE' });
    expect(await affiliateRespond(caster, r.appointment.id, true)).toMatchObject({ ok: false });
    // Only the affiliate it was sent to may answer.
    expect(await affiliateAcceptRequest(agent, r.appointment.id)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(await affiliateAcceptRequest(caster, r.appointment.id)).toEqual({ ok: true });
    expect(await affiliateAcceptRequest(caster, r.appointment.id)).toEqual({
      ok: false,
      error: 'BAD_STATE',
    });
    expect((await noticesOf(agent)).map((n) => n.title)).toContain(
      'Café Plus a accepté votre rendez-vous',
    );
    expect(await noticesOf(admin)).toHaveLength(2);
  });

  it('the affiliate proposes another slot inside the agent’s calendar; the agent accepts it', async () => {
    const { admin, agent, caster } = await setup();
    const r = await request(agent, caster);
    if (!r.ok) throw new Error('request failed');
    await db.insert(agentUnavailableDays).values({ agentUserId: agent, day: '2026-10-21' });
    await db
      .insert(agentUnavailableHours)
      .values({ agentUserId: agent, day: '2026-10-22', hour: 9 });
    expect(
      await affiliateProposeSlot(
        caster,
        r.appointment.id,
        { day: '2026-10-21', hour: 9, minute: 0 },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'DAY_UNAVAILABLE' });
    expect(
      await affiliateProposeSlot(
        caster,
        r.appointment.id,
        { day: '2026-10-22', hour: 9, minute: 15 },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'HOUR_UNAVAILABLE' });
    expect(
      await affiliateProposeSlot(
        caster,
        r.appointment.id,
        { day: '2026-10-22', hour: 14, minute: 15 },
        NOW,
      ),
    ).toEqual({ ok: true });
    expect((await noticesOf(agent)).map((n) => n.title)).toContain(
      'Café Plus propose un autre horaire : le 22/10/2026 à 14h15',
    );
    // The affiliate cannot accept his own counter-proposal.
    expect(await affiliateAcceptRequest(caster, r.appointment.id)).toEqual({
      ok: false,
      error: 'BAD_STATE',
    });
    expect(await agentAcceptProposedSlot(agent, r.appointment.id)).toEqual({ ok: true });
    const [row] = await db
      .select()
      .from(agentAppointments)
      .where(eq(agentAppointments.id, r.appointment.id));
    expect(row).toMatchObject({
      status: 'confirme',
      day: '2026-10-22',
      hour: 14,
      minute: 15,
      proposedDay: null,
    });
    expect((await noticesOf(caster)).map((n) => n.title)).toContain(
      'Votre rendez-vous le 22/10/2026 à 14h15 est confirmé',
    );
    expect(await noticesOf(admin)).toHaveLength(3);
  });

  it('one live rendez-vous per hour for the agent; a cancellation tells the team', async () => {
    const { admin, agent, caster } = await setup();
    const r = await request(agent, caster);
    if (!r.ok) throw new Error('request failed');
    expect(await request(agent, caster, { minute: 0 })).toEqual({ ok: false, error: 'SLOT_TAKEN' });
    const c = await cancelAppointment('agent', agent, r.appointment.id);
    expect(c.ok).toBe(true);
    if (c.ok && c.appointment) await noticeRdvCancelled(c.appointment, 'agent');
    const adminRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, admin), eq(notifications.type, ADMIN_RDV_TYPE)));
    expect(adminRows.map((n) => n.title)).toContain('Rendez-vous annulé par l’agent');
    expect(adminRows[0]?.body).toContain('Agent : Amine Agent · Café Plus · le 20/10/2026 à 10h30');
    expect(await request(agent, caster, { minute: 0 })).toMatchObject({ ok: true });
  });

  it('the email button opens the right page for each recipient', () => {
    expect(emailPath(RDV_REQUEST_TYPE, null, 'advertiser')).toBe('/dashboard?rdv=1');
    expect(emailPath(RDV_REQUEST_TYPE, null, 'individual_owner')).toBe('/owner-dashboard?rdv=1');
    expect(emailPath(ADMIN_RDV_TYPE, null, 'admin')).toBe('/admin-agents');
    expect(emailPath('agent_appointment_sent', '/agent/calendrier', 'screenhost_agent')).toBe(
      '/agent/calendrier',
    );
  });
});
