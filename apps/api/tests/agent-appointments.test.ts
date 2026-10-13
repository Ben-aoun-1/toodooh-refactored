import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agentAppointmentObjectives,
  agentAppointments,
  agents,
  notifications,
  users,
} from '../src/db/schema.js';
import {
  affiliateRespond,
  agentAccept,
  agentPropose,
  appointmentsOf,
  cancelAppointment,
  requestAppointment,
  runAgentAppointmentTick,
  setAvailability,
} from '../src/lib/agent-appointments.js';

import { seedLiveAffiliation } from './helpers/agent-affiliation.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// AGT-5 — agent appointments (spec §7) on a real Postgres: one live request per slot, the
// agent's unavailable days, the counter-proposal round trip, expiry and the 24 h reminder.

const NOW = new Date('2026-10-13T08:00:00Z');
const DAY = '2026-10-20';

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `agt5-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const setup = async () => {
  const agent = await seedUser({ role: 'screencast_agent', contactName: 'Amine Agent' });
  await db
    .insert(agents)
    .values({ userId: agent, code: `SC${100000 + seq}`, accountStatus: 'actif' });
  const a = await seedUser({ role: 'advertiser', businessName: 'Café Plus' });
  const b = await seedUser({ role: 'advertiser', businessName: 'Pub SARL' });
  await seedLiveAffiliation({ agentUserId: agent, referredUserId: a });
  await seedLiveAffiliation({ agentUserId: agent, referredUserId: b });
  const [objective] = await db
    .select()
    .from(agentAppointmentObjectives)
    .where(eq(agentAppointmentObjectives.agentRole, 'screencast_agent'))
    .limit(1);
  return { agent, a, b, objectiveId: objective?.id ?? '' };
};

describe('AGT-5 — agent appointments (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a request holds its slot; unavailable, past and referent-less requests are refused', async () => {
    const s = await setup();
    const req = { objectiveId: s.objectiveId, day: DAY, hour: 10, message: 'Brief' };
    const first = await requestAppointment(s.a, req, NOW);
    expect(first.ok).toBe(true);
    expect(await requestAppointment(s.b, req, NOW)).toEqual({ ok: false, error: 'SLOT_TAKEN' });
    expect(await requestAppointment(s.b, { ...req, day: '2026-10-01' }, NOW)).toEqual({
      ok: false,
      error: 'PAST_SLOT',
    });
    expect(await requestAppointment(s.b, { ...req, hour: 20 }, NOW)).toEqual({
      ok: false,
      error: 'NOT_A_SLOT',
    });
    await setAvailability(s.agent, ['2026-10-21'], false, NOW);
    expect(await requestAppointment(s.b, { ...req, day: '2026-10-21' }, NOW)).toEqual({
      ok: false,
      error: 'DAY_UNAVAILABLE',
    });
    const loner = await seedUser({ role: 'advertiser' });
    expect(await requestAppointment(loner, req, NOW)).toEqual({ ok: false, error: 'NO_REFERENT' });

    const notes = await db.select().from(notifications).where(eq(notifications.userId, s.agent));
    expect(notes.map((n) => n.title)).toEqual([
      'Demande de rendez-vous de Café Plus le 20/10/2026 à 10h00',
    ]);
    expect(notes[0]?.appointmentId).toBe(first.ok ? first.appointment.id : null);
  });

  it('two affiliates asking the same slot at the same instant: exactly one request exists', async () => {
    const s = await setup();
    const req = { objectiveId: s.objectiveId, day: DAY, hour: 11, message: null };
    const results = await Promise.all([
      requestAppointment(s.a, req, NOW),
      requestAppointment(s.b, req, NOW),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'SLOT_TAKEN' }]);
    expect(await db.select().from(agentAppointments)).toHaveLength(1);
  });

  it('counter-proposal: the proposed slot is held, accepting moves the appointment and confirms it', async () => {
    const s = await setup();
    const r = await requestAppointment(
      s.a,
      { objectiveId: s.objectiveId, day: DAY, hour: 9, message: null },
      NOW,
    );
    const id = r.ok ? r.appointment.id : '';
    expect(await agentPropose(s.agent, id, DAY, 15, NOW)).toEqual({ ok: true });
    expect(
      await requestAppointment(
        s.b,
        { objectiveId: s.objectiveId, day: DAY, hour: 15, message: null },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'SLOT_TAKEN' });
    expect(await agentAccept(s.agent, id)).toEqual({ ok: false, error: 'BAD_STATE' });
    expect(await affiliateRespond(s.a, id, true)).toEqual({ ok: true });
    const [row] = await db.select().from(agentAppointments).where(eq(agentAppointments.id, id));
    expect(row).toMatchObject({ status: 'confirme', day: DAY, hour: 15, proposedDay: null });
    const titles = (
      await db.select().from(notifications).where(eq(notifications.userId, s.agent))
    ).map((n) => n.title);
    expect(titles).toContain('Café Plus a accepté le nouvel horaire');
    // The 09:00 slot was freed by the move.
    expect(
      (
        await requestAppointment(
          s.b,
          { objectiveId: s.objectiveId, day: DAY, hour: 9, message: null },
          NOW,
        )
      ).ok,
    ).toBe(true);
  });

  it('a confirmed day can go unavailable (kept, flagged); cancelling frees the slot', async () => {
    const s = await setup();
    const r = await requestAppointment(
      s.a,
      { objectiveId: s.objectiveId, day: DAY, hour: 14, message: null },
      NOW,
    );
    const id = r.ok ? r.appointment.id : '';
    await agentAccept(s.agent, id);
    expect(await setAvailability(s.agent, [DAY, '2026-10-01'], false, NOW)).toEqual({
      changed: [DAY],
      confirmed_kept: [DAY],
    });
    expect((await appointmentsOf('agent', s.agent, NOW))[0]?.status).toBe('confirme');
    expect(await cancelAppointment('affilie', s.a, id)).toEqual({ ok: true });
    await setAvailability(s.agent, [DAY], true, NOW);
    expect(
      (
        await requestAppointment(
          s.b,
          { objectiveId: s.objectiveId, day: DAY, hour: 14, message: null },
          NOW,
        )
      ).ok,
    ).toBe(true);
  });

  it('the tick expires unanswered requests, reminds 24 h ahead once, and derives « Passé »', async () => {
    const s = await setup();
    const pending = await requestAppointment(
      s.a,
      { objectiveId: s.objectiveId, day: DAY, hour: 9, message: null },
      NOW,
    );
    const confirmed = await requestAppointment(
      s.b,
      { objectiveId: s.objectiveId, day: DAY, hour: 16, message: null },
      NOW,
    );
    await agentAccept(s.agent, confirmed.ok ? confirmed.appointment.id : '');

    const dayBefore = new Date('2026-10-19T16:00:00Z'); // 17:00 Tunis, 23 h before 16:00
    expect(await runAgentAppointmentTick(dayBefore)).toEqual({ expired: 0, reminded: 1 });
    expect(await runAgentAppointmentTick(dayBefore)).toEqual({ expired: 0, reminded: 0 });
    const titles = (
      await db.select().from(notifications).where(eq(notifications.userId, s.agent))
    ).map((n) => n.title);
    expect(titles).toContain('Rappel : rendez-vous avec Pub SARL demain à 16h00');

    const after = new Date('2026-10-20T16:00:00Z');
    expect((await runAgentAppointmentTick(after)).expired).toBe(1);
    const views = await appointmentsOf('agent', s.agent, after);
    expect(views.find((v) => v.id === (pending.ok ? pending.appointment.id : ''))?.status).toBe(
      'expire',
    );
    expect(views.find((v) => v.id === (confirmed.ok ? confirmed.appointment.id : ''))?.status).toBe(
      'passe',
    );
  });
});
