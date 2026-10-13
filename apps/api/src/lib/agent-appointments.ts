import { addDays } from 'date-fns';
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  type AgentAppointment,
  agentAffiliations,
  agentAppointmentObjectives,
  agentAppointments,
  agentUnavailableDays,
  agents,
  notifications,
  screenhosts,
  users,
} from '../db/schema.js';

import { liveScAffiliation } from './agent-commissions.js';
import type { AgentRole } from './agent-sheet.js';
import { tunisDateOf } from './campaign-dates.js';
import { userLabel, userLabelById } from './user-label.js';

// AGT-5 (agent specs v1.0 §7) — appointments between an agent and its affiliates, one home.
// The agent calendar and the affiliate's « Prendre rendez-vous » read and write the same rows:
// a day the agent marks unavailable is immediately unbookable; a slot held by a request that is
// En attente, Nouvel horaire proposé or Confirmé is taken (one live request per slot, enforced by
// a partial unique index); Annulé / Expiré free it. « Passé » is a Confirmé whose time is over.

/** One-hour slots offered in a day (Tunis time): 09:00 → 17:00 starts. */
export const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

const LIVE = ['en_attente', 'nouvel_horaire', 'confirme'] as const;

/** The slot's instant (Tunisia is UTC+1 all year). */
export const slotInstant = (day: string, hour: number): Date =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+01:00`);

export const frDay = (day: string) => day.split('-').reverse().join('/');
export const frHour = (hour: number) => `${String(hour).padStart(2, '0')}h00`;

export interface Referent {
  agentUserId: string;
  agentRole: AgentRole;
  screenhostId: string | null;
}

/**
 * The affiliate's referring agent: a Screencaster's live affiliation, or — for a Screenhost
 * owner — the agent of one of its venues while it is pending activation or running. A closed or
 * suspended agent account is no referent (the Toodooh team path applies).
 */
export const referentOf = async (
  userId: string,
  now: Date = new Date(),
): Promise<Referent | null> => {
  const sc = await liveScAffiliation(userId, tunisDateOf(now));
  const candidates = sc
    ? [sc.affiliation]
    : await db
        .select()
        .from(agentAffiliations)
        .where(
          and(
            eq(agentAffiliations.referredUserId, userId),
            inArray(agentAffiliations.status, ['en_attente_activation', 'en_cours']),
            sql`${agentAffiliations.screenhostId} is not null`,
          ),
        )
        .orderBy(asc(agentAffiliations.attachedAt));
  for (const a of candidates) {
    if (a.agentRole === 'screencast_agent' && a.status !== 'en_cours') continue;
    const [agent] = await db
      .select({ status: agents.accountStatus })
      .from(agents)
      .where(eq(agents.userId, a.agentUserId))
      .limit(1);
    if (agent?.status !== 'actif') continue;
    return { agentUserId: a.agentUserId, agentRole: a.agentRole, screenhostId: a.screenhostId };
  }
  return null;
};

export const objectivesFor = (role: AgentRole) =>
  db
    .select({ id: agentAppointmentObjectives.id, label: agentAppointmentObjectives.label })
    .from(agentAppointmentObjectives)
    .where(
      and(
        eq(agentAppointmentObjectives.agentRole, role),
        eq(agentAppointmentObjectives.active, true),
      ),
    )
    .orderBy(asc(agentAppointmentObjectives.position), asc(agentAppointmentObjectives.label));

/** Unavailable days and taken slots of one agent between two days (inclusive, exclusive). */
export const agentCalendar = async (agentUserId: string, from: string, to: string) => {
  const off = await db
    .select({ day: agentUnavailableDays.day })
    .from(agentUnavailableDays)
    .where(
      and(
        eq(agentUnavailableDays.agentUserId, agentUserId),
        gte(agentUnavailableDays.day, from),
        lt(agentUnavailableDays.day, to),
      ),
    );
  const live = await db
    .select()
    .from(agentAppointments)
    .where(
      and(
        eq(agentAppointments.agentUserId, agentUserId),
        inArray(agentAppointments.status, [...LIVE]),
        or(
          and(gte(agentAppointments.day, from), lt(agentAppointments.day, to)),
          and(gte(agentAppointments.proposedDay, from), lt(agentAppointments.proposedDay, to)),
        ),
      ),
    );
  const taken: { day: string; hour: number }[] = [];
  for (const a of live) {
    taken.push({ day: a.day, hour: a.hour });
    if (a.status === 'nouvel_horaire' && a.proposedDay && a.proposedHour !== null) {
      taken.push({ day: a.proposedDay, hour: a.proposedHour });
    }
  }
  return { unavailable: off.map((o) => o.day), taken };
};

export type SlotError = 'PAST_SLOT' | 'NOT_A_SLOT' | 'DAY_UNAVAILABLE' | 'SLOT_TAKEN';

/** Whether the agent can still be asked for that slot (excluding one appointment's own hold). */
export const slotProblem = async (
  agentUserId: string,
  day: string,
  hour: number,
  now: Date,
  ignoreAppointmentId?: string,
): Promise<SlotError | null> => {
  if (!SLOT_HOURS.includes(hour as (typeof SLOT_HOURS)[number])) return 'NOT_A_SLOT';
  if (slotInstant(day, hour) <= now) return 'PAST_SLOT';
  const next = tunisDateOf(addDays(new Date(`${day}T12:00:00Z`), 1));
  const cal = await agentCalendar(agentUserId, day, next);
  if (cal.unavailable.includes(day)) return 'DAY_UNAVAILABLE';
  const held = await db
    .select({ id: agentAppointments.id })
    .from(agentAppointments)
    .where(
      and(
        eq(agentAppointments.agentUserId, agentUserId),
        inArray(agentAppointments.status, [...LIVE]),
        or(
          and(eq(agentAppointments.day, day), eq(agentAppointments.hour, hour)),
          and(eq(agentAppointments.proposedDay, day), eq(agentAppointments.proposedHour, hour)),
        ),
      ),
    );
  return held.some((h) => h.id !== ignoreAppointmentId) ? 'SLOT_TAKEN' : null;
};

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

const notify = (
  userId: string,
  type: string,
  title: string,
  body: string,
  appointmentId: string,
  link: string | null,
) => db.insert(notifications).values({ userId, type, title, body, appointmentId, link });

const AGENT_LINK = '/agent/calendrier';

export type BookResult =
  | { ok: true; appointment: AgentAppointment }
  | { ok: false; error: SlotError | 'NO_REFERENT' | 'BAD_OBJECTIVE' };

/** The affiliate asks for a slot: En attente, the agent is notified. */
export const requestAppointment = async (
  affiliateUserId: string,
  input: { objectiveId: string; day: string; hour: number; message: string | null },
  now: Date = new Date(),
): Promise<BookResult> => {
  const ref = await referentOf(affiliateUserId, now);
  if (!ref) return { ok: false, error: 'NO_REFERENT' };
  const objectives = await objectivesFor(ref.agentRole);
  if (!objectives.some((o) => o.id === input.objectiveId)) {
    return { ok: false, error: 'BAD_OBJECTIVE' };
  }
  const problem = await slotProblem(ref.agentUserId, input.day, input.hour, now);
  if (problem) return { ok: false, error: problem };
  let row: AgentAppointment | undefined;
  try {
    [row] = await db
      .insert(agentAppointments)
      .values({
        agentUserId: ref.agentUserId,
        affiliateUserId,
        screenhostId: ref.screenhostId,
        objectiveId: input.objectiveId,
        day: input.day,
        hour: input.hour,
        message: input.message,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'SLOT_TAKEN' };
    throw err;
  }
  if (!row) throw new Error('appointment insert failed');
  const name = await userLabelById(affiliateUserId);
  await notify(
    ref.agentUserId,
    'agent_appointment_requested',
    `Demande de rendez-vous de ${name} le ${frDay(row.day)} à ${frHour(row.hour)}`,
    input.message ?? 'Consultez la demande dans votre calendrier.',
    row.id,
    AGENT_LINK,
  );
  return { ok: true, appointment: row };
};

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: 'NOT_FOUND' | 'BAD_STATE' | SlotError };

const load = async (id: string) =>
  (await db.select().from(agentAppointments).where(eq(agentAppointments.id, id)).limit(1))[0];

const setStatus = (
  id: string,
  from: AgentAppointment['status'][],
  set: Partial<AgentAppointment>,
) =>
  db
    .update(agentAppointments)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(agentAppointments.id, id), inArray(agentAppointments.status, from)))
    .returning({ id: agentAppointments.id });

/** Agent: accept a pending request. */
export const agentAccept = async (agentUserId: string, id: string): Promise<TransitionResult> => {
  const a = await load(id);
  if (!a || a.agentUserId !== agentUserId) return { ok: false, error: 'NOT_FOUND' };
  if ((await setStatus(id, ['en_attente'], { status: 'confirme' })).length === 0) {
    return { ok: false, error: 'BAD_STATE' };
  }
  const agentName = await userLabelById(agentUserId);
  await notify(
    a.affiliateUserId,
    'appointment_confirmed',
    `Votre rendez-vous du ${frDay(a.day)} à ${frHour(a.hour)} est confirmé`,
    `${agentName} vous attend à l’heure convenue.`,
    id,
    null,
  );
  return { ok: true };
};

/** Agent: propose another slot (the request then waits for the affiliate's answer). */
export const agentPropose = async (
  agentUserId: string,
  id: string,
  day: string,
  hour: number,
  now: Date = new Date(),
): Promise<TransitionResult> => {
  const a = await load(id);
  if (!a || a.agentUserId !== agentUserId) return { ok: false, error: 'NOT_FOUND' };
  if (a.status !== 'en_attente') return { ok: false, error: 'BAD_STATE' };
  const problem = await slotProblem(agentUserId, day, hour, now, id);
  if (problem) return { ok: false, error: problem };
  const done = await setStatus(id, ['en_attente'], {
    status: 'nouvel_horaire',
    proposedDay: day,
    proposedHour: hour,
  });
  if (done.length === 0) return { ok: false, error: 'BAD_STATE' };
  const agentName = await userLabelById(agentUserId);
  await notify(
    a.affiliateUserId,
    'appointment_rescheduled',
    `${agentName} propose un nouvel horaire : le ${frDay(day)} à ${frHour(hour)}`,
    'Acceptez ou déclinez ce nouvel horaire.',
    id,
    null,
  );
  return { ok: true };
};

/** Affiliate: accept or decline the agent's counter-proposal. */
export const affiliateRespond = async (
  affiliateUserId: string,
  id: string,
  accept: boolean,
): Promise<TransitionResult> => {
  const a = await load(id);
  if (!a || a.affiliateUserId !== affiliateUserId) return { ok: false, error: 'NOT_FOUND' };
  if (a.status !== 'nouvel_horaire' || !a.proposedDay || a.proposedHour === null) {
    return { ok: false, error: 'BAD_STATE' };
  }
  try {
    const done = await setStatus(
      id,
      ['nouvel_horaire'],
      accept
        ? {
            status: 'confirme',
            day: a.proposedDay,
            hour: a.proposedHour,
            proposedDay: null,
            proposedHour: null,
          }
        : { status: 'annule', cancelledBy: 'affilie' },
    );
    if (done.length === 0) return { ok: false, error: 'BAD_STATE' };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'SLOT_TAKEN' };
    throw err;
  }
  const name = await userLabelById(affiliateUserId);
  await notify(
    a.agentUserId,
    accept ? 'agent_appointment_accepted' : 'agent_appointment_declined',
    `${name} a ${accept ? 'accepté' : 'décliné'} le nouvel horaire`,
    accept
      ? `Rendez-vous confirmé le ${frDay(a.proposedDay)} à ${frHour(a.proposedHour)}.`
      : 'La demande est annulée.',
    id,
    AGENT_LINK,
  );
  return { ok: true };
};

/** Either party cancels a live appointment; the other is notified and the slot is freed. */
export const cancelAppointment = async (
  by: 'agent' | 'affilie',
  userId: string,
  id: string,
): Promise<TransitionResult> => {
  const a = await load(id);
  const own = a && (by === 'agent' ? a.agentUserId : a.affiliateUserId) === userId;
  if (!a || !own) return { ok: false, error: 'NOT_FOUND' };
  const done = await setStatus(id, [...LIVE], { status: 'annule', cancelledBy: by });
  if (done.length === 0) return { ok: false, error: 'BAD_STATE' };
  if (by === 'affilie') {
    const name = await userLabelById(userId);
    await notify(
      a.agentUserId,
      'agent_appointment_cancelled',
      `Rendez-vous annulé par ${name}`,
      `Le rendez-vous du ${frDay(a.day)} à ${frHour(a.hour)} est annulé.`,
      id,
      AGENT_LINK,
    );
  } else {
    const agentName = await userLabelById(userId);
    await notify(
      a.affiliateUserId,
      'appointment_cancelled',
      `Votre rendez-vous du ${frDay(a.day)} à ${frHour(a.hour)} a été annulé`,
      `${agentName} a annulé le rendez-vous. Vous pouvez en demander un autre.`,
      id,
      null,
    );
  }
  return { ok: true };
};

/** The agent marks future days unavailable (or available again); past days never change. */
export const setAvailability = async (
  agentUserId: string,
  days: string[],
  available: boolean,
  now: Date = new Date(),
): Promise<{ changed: string[]; confirmed_kept: string[] }> => {
  const today = tunisDateOf(now);
  const future = [...new Set(days)].filter((d) => d >= today);
  if (future.length === 0) return { changed: [], confirmed_kept: [] };
  if (available) {
    await db
      .delete(agentUnavailableDays)
      .where(
        and(
          eq(agentUnavailableDays.agentUserId, agentUserId),
          inArray(agentUnavailableDays.day, future),
        ),
      );
    return { changed: future, confirmed_kept: [] };
  }
  await db
    .insert(agentUnavailableDays)
    .values(future.map((day) => ({ agentUserId, day })))
    .onConflictDoNothing();
  const kept = await db
    .selectDistinct({ day: agentAppointments.day })
    .from(agentAppointments)
    .where(
      and(
        eq(agentAppointments.agentUserId, agentUserId),
        eq(agentAppointments.status, 'confirme'),
        inArray(agentAppointments.day, future),
      ),
    );
  return { changed: future, confirmed_kept: kept.map((k) => k.day) };
};

export interface AppointmentView {
  id: string;
  status: AgentAppointment['status'] | 'passe';
  day: string;
  hour: number;
  proposed_day: string | null;
  proposed_hour: number | null;
  message: string | null;
  objective: string | null;
  counterpart_id: string;
  counterpart_name: string;
  venue_name: string | null;
  venue_address: string | null;
  cancelled_by: 'agent' | 'affilie' | null;
}

/** The appointments of one side, newest slot first, with « Passé » derived. */
export const appointmentsOf = async (
  side: 'agent' | 'affilie',
  userId: string,
  now: Date = new Date(),
): Promise<AppointmentView[]> => {
  const rows = await db
    .select({
      a: agentAppointments,
      objective: agentAppointmentObjectives.label,
      venue: screenhosts,
    })
    .from(agentAppointments)
    .leftJoin(
      agentAppointmentObjectives,
      eq(agentAppointmentObjectives.id, agentAppointments.objectiveId),
    )
    .leftJoin(screenhosts, eq(screenhosts.id, agentAppointments.screenhostId))
    .where(
      side === 'agent'
        ? eq(agentAppointments.agentUserId, userId)
        : eq(agentAppointments.affiliateUserId, userId),
    );
  const ids = [
    ...new Set(rows.map((r) => (side === 'agent' ? r.a.affiliateUserId : r.a.agentUserId))),
  ];
  const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : [];
  const nameOf = new Map(people.map((p) => [p.id, userLabel(p)]));
  return rows
    .map(({ a, objective, venue }) => {
      const counterpart = side === 'agent' ? a.affiliateUserId : a.agentUserId;
      const past = a.status === 'confirme' && slotInstant(a.day, a.hour) <= now;
      return {
        id: a.id,
        status: past ? ('passe' as const) : a.status,
        day: a.day,
        hour: a.hour,
        proposed_day: a.proposedDay,
        proposed_hour: a.proposedHour,
        message: a.message,
        objective,
        counterpart_id: counterpart,
        counterpart_name: nameOf.get(counterpart) ?? '—',
        venue_name: venue?.name ?? null,
        venue_address: venue
          ? [venue.address, venue.city].filter(Boolean).join(', ') || null
          : null,
        cancelled_by: a.cancelledBy,
      };
    })
    .sort((x, y) => `${y.day}${y.hour}`.localeCompare(`${x.day}${x.hour}`));
};

/** Expire requests left unanswered past their time; remind the agent 24 h before a Confirmé. */
export const runAgentAppointmentTick = async (now: Date = new Date()) => {
  const open = await db
    .select()
    .from(agentAppointments)
    .where(inArray(agentAppointments.status, ['en_attente', 'nouvel_horaire']));
  let expired = 0;
  for (const a of open) {
    if (slotInstant(a.day, a.hour) > now) continue;
    const done = await setStatus(a.id, ['en_attente', 'nouvel_horaire'], { status: 'expire' });
    expired += done.length;
  }
  const soon = await db
    .select({ a: agentAppointments, remind: users.notifyRemindersEvents })
    .from(agentAppointments)
    .innerJoin(users, eq(users.id, agentAppointments.agentUserId))
    .where(and(eq(agentAppointments.status, 'confirme'), isNull(agentAppointments.reminderSentAt)));
  let reminded = 0;
  for (const { a, remind } of soon) {
    const at = slotInstant(a.day, a.hour).getTime();
    const ms = at - now.getTime();
    if (ms <= 0 || ms > 24 * 60 * 60 * 1000) continue;
    const claimed = await db
      .update(agentAppointments)
      .set({ reminderSentAt: now })
      .where(and(eq(agentAppointments.id, a.id), isNull(agentAppointments.reminderSentAt)))
      .returning({ id: agentAppointments.id });
    if (claimed.length === 0 || !remind) continue;
    const name = await userLabelById(a.affiliateUserId);
    await notify(
      a.agentUserId,
      'agent_appointment_reminder',
      `Rappel : rendez-vous avec ${name} demain à ${frHour(a.hour)}`,
      `Le ${frDay(a.day)} à ${frHour(a.hour)}.`,
      a.id,
      AGENT_LINK,
    );
    reminded += 1;
  }
  return { expired, reminded };
};

/** Boot + every 5 minutes, unref'd. */
export function startAgentAppointmentJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runAgentAppointmentTick().catch((err: unknown) =>
      log.warn({ err }, 'agent appointment tick failed'),
    );
  tick();
  setInterval(tick, 5 * 60 * 1000).unref();
}
