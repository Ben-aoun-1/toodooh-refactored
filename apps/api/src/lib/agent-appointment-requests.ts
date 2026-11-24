import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  type AgentAppointment,
  type AgentAppointmentPlace,
  agentAffiliations,
  agentAppointments,
  screenhosts,
  users,
} from '../db/schema.js';

import { notifyAdmins } from './admin-notifications.js';
import {
  AGENT_LINK,
  type TransitionResult,
  agentCalendar,
  frDay,
  frHour,
  isUniqueViolation,
  loadAppointment,
  notify,
  setAppointmentStatus,
  slotInstant,
} from './agent-appointments.js';
import type { AgentRole } from './agent-sheet.js';
import { userLabel, userLabelById } from './user-label.js';

// AGENT-VF (Mariem 12/11/2026, Agent Screenhost spec VF §13 / Agent Screencaster spec VF §9) — the
// agent asks one of his affiliates for a rendez-vous himself. Same table as the affiliate's own
// requests (lib/agent-appointments.ts), the roles inverted: the affiliate accepts or proposes
// another slot, the agent then accepts that slot or cancels. The Toodooh team is told at every
// step (in-app + email), the affiliate is told of the request (in-app + email).

export const RDV_PLACES: readonly AgentAppointmentPlace[] = ['sur_place', 'telephone', 'visio'];

export const RDV_PLACE_FR: Record<AgentAppointmentPlace, string> = {
  sur_place: 'Sur place',
  telephone: 'Par téléphone',
  visio: 'En visio',
};

/** The four subjects of each spec, in the spec's order. */
export const RDV_SUBJECTS: Record<AgentRole, readonly string[]> = {
  screenhost_agent: [
    'Visite de l’établissement',
    'Installation ou vérification du capteur',
    'Point de suivi',
    'Autre',
  ],
  screencast_agent: [
    'Présentation de Toodooh',
    'Préparation d’une campagne',
    'Point de suivi',
    'Autre',
  ],
};

export const RDV_MINUTES = [0, 15, 30, 45] as const;

/** The notice types that are emailed whatever the recipient's role (lib/agent-notifications). */
export const RDV_REQUEST_TYPE = 'appointment_agent_request';
export const ADMIN_RDV_TYPE = 'admin_agent_appointment';

export interface RdvTarget {
  /** The venue (Screenhost agent) or the Screencaster's user id (Screencaster agent). */
  id: string;
  name: string;
  affiliate_user_id: string;
  screenhost_id: string | null;
}

/**
 * Who the agent may ask: his affiliates whose affiliation is not ended (pending activation or
 * running) — one entry per venue for a Screenhost agent, one per Screencaster otherwise.
 */
export const rdvTargets = async (agentUserId: string, role: AgentRole): Promise<RdvTarget[]> => {
  const rows = await db
    .select({ a: agentAffiliations, venue: screenhosts.name, user: users })
    .from(agentAffiliations)
    .innerJoin(users, eq(users.id, agentAffiliations.referredUserId))
    .leftJoin(screenhosts, eq(screenhosts.id, agentAffiliations.screenhostId))
    .where(
      and(
        eq(agentAffiliations.agentUserId, agentUserId),
        eq(agentAffiliations.agentRole, role),
        inArray(agentAffiliations.status, ['en_attente_activation', 'en_cours']),
        role === 'screenhost_agent'
          ? sql`${agentAffiliations.screenhostId} is not null`
          : isNull(agentAffiliations.screenhostId),
        isNull(users.deactivatedAt),
      ),
    )
    .orderBy(asc(agentAffiliations.attachedAt));
  return rows.map(({ a, venue, user }) => ({
    id: a.screenhostId ?? a.referredUserId,
    name: (a.screenhostId ? venue : null) ?? userLabel(user),
    affiliate_user_id: a.referredUserId,
    screenhost_id: a.screenhostId,
  }));
};

export type RdvRequestError =
  | 'NOT_YOUR_AFFILIATE'
  | 'BAD_SUBJECT'
  | 'PAST_SLOT'
  | 'SLOT_TAKEN'
  | 'DAY_UNAVAILABLE'
  | 'HOUR_UNAVAILABLE';

export interface RdvRequestInput {
  targetId: string;
  day: string;
  hour: number;
  minute: number;
  place: AgentAppointmentPlace;
  subject: string;
  message: string | null;
}

const when = (day: string, hour: number, minute: number) =>
  `le ${frDay(day)} à ${frHour(hour, minute)}`;

const tellAdmins = async (title: string, a: AgentAppointment, targetName: string) => {
  const agentName = await userLabelById(a.agentUserId);
  const place = a.place ? RDV_PLACE_FR[a.place] : '–';
  await notifyAdmins(db, {
    type: ADMIN_RDV_TYPE,
    title,
    body: `Agent : ${agentName} · ${targetName} · ${when(a.day, a.hour, a.minute)} · ${place} · ${a.subject ?? '–'}`,
  });
};

const targetNameOf = async (a: AgentAppointment): Promise<string> => {
  if (a.screenhostId) {
    const [v] = await db
      .select({ name: screenhosts.name })
      .from(screenhosts)
      .where(eq(screenhosts.id, a.screenhostId))
      .limit(1);
    if (v?.name) return v.name;
  }
  return userLabelById(a.affiliateUserId);
};

/** The agent sends the request: En attente (« En attente de réponse » for him). */
export const agentRequestAppointment = async (
  agentUserId: string,
  role: AgentRole,
  input: RdvRequestInput,
  now: Date = new Date(),
): Promise<
  | { ok: true; appointment: AgentAppointment; target: string }
  | { ok: false; error: RdvRequestError }
> => {
  const target = (await rdvTargets(agentUserId, role)).find((t) => t.id === input.targetId);
  if (!target) return { ok: false, error: 'NOT_YOUR_AFFILIATE' };
  if (!RDV_SUBJECTS[role].includes(input.subject)) return { ok: false, error: 'BAD_SUBJECT' };
  if (slotInstant(input.day, input.hour, input.minute) <= now) {
    return { ok: false, error: 'PAST_SLOT' };
  }
  let row: AgentAppointment | undefined;
  try {
    [row] = await db
      .insert(agentAppointments)
      .values({
        agentUserId,
        affiliateUserId: target.affiliate_user_id,
        screenhostId: target.screenhost_id,
        day: input.day,
        hour: input.hour,
        minute: input.minute,
        place: input.place,
        subject: input.subject,
        message: input.message,
        initiatedBy: 'agent',
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'SLOT_TAKEN' };
    throw err;
  }
  if (!row) throw new Error('appointment insert failed');
  const agentName = await userLabelById(agentUserId);
  const slot = when(row.day, row.hour, row.minute);
  await notify(
    target.affiliate_user_id,
    RDV_REQUEST_TYPE,
    `${agentName} vous propose un rendez-vous ${slot} (${RDV_PLACE_FR[input.place]}) : ${input.subject}`,
    input.message ?? 'Acceptez-le ou proposez un autre horaire.',
    row.id,
    null,
  );
  await notify(
    agentUserId,
    'agent_appointment_sent',
    `Demande de rendez-vous envoyée à ${target.name}`,
    `${slot.charAt(0).toUpperCase()}${slot.slice(1)}, ${RDV_PLACE_FR[input.place].toLowerCase()} : ${input.subject}.`,
    row.id,
    AGENT_LINK,
  );
  await tellAdmins(`Demande de rendez-vous d’un agent : ${target.name}`, row, target.name);
  return { ok: true, appointment: row, target: target.name };
};

const mine = async (affiliateUserId: string, id: string) => {
  const a = await loadAppointment(id);
  return a && a.affiliateUserId === affiliateUserId && a.initiatedBy === 'agent' ? a : null;
};

/** Affiliate: accept the agent's request as asked. */
export const affiliateAcceptRequest = async (
  affiliateUserId: string,
  id: string,
): Promise<TransitionResult> => {
  const a = await mine(affiliateUserId, id);
  if (!a) return { ok: false, error: 'NOT_FOUND' };
  if ((await setAppointmentStatus(id, ['en_attente'], { status: 'confirme' })).length === 0) {
    return { ok: false, error: 'BAD_STATE' };
  }
  const name = await targetNameOf(a);
  await notify(
    a.agentUserId,
    'agent_appointment_accepted',
    `${name} a accepté votre rendez-vous`,
    `Rendez-vous confirmé ${when(a.day, a.hour, a.minute)}.`,
    id,
    AGENT_LINK,
  );
  await tellAdmins(`Rendez-vous accepté par ${name}`, a, name);
  return { ok: true };
};

/** Affiliate: propose another slot; the agent then accepts it or cancels. */
export const affiliateProposeSlot = async (
  affiliateUserId: string,
  id: string,
  slot: { day: string; hour: number; minute: number },
  now: Date = new Date(),
): Promise<TransitionResult> => {
  const a = await mine(affiliateUserId, id);
  if (!a) return { ok: false, error: 'NOT_FOUND' };
  if (a.status !== 'en_attente') return { ok: false, error: 'BAD_STATE' };
  if (slotInstant(slot.day, slot.hour, slot.minute) <= now) {
    return { ok: false, error: 'PAST_SLOT' };
  }
  // The agent's own calendar still rules: a day or an hour he blocked cannot be proposed.
  const cal = await agentCalendar(a.agentUserId, slot.day, nextDay(slot.day));
  if (cal.unavailable.includes(slot.day)) return { ok: false, error: 'DAY_UNAVAILABLE' };
  if (cal.unavailableHours.some((o) => o.day === slot.day && o.hour === slot.hour)) {
    return { ok: false, error: 'HOUR_UNAVAILABLE' };
  }
  const done = await setAppointmentStatus(id, ['en_attente'], {
    status: 'nouvel_horaire',
    proposedDay: slot.day,
    proposedHour: slot.hour,
    proposedMinute: slot.minute,
  });
  if (done.length === 0) return { ok: false, error: 'BAD_STATE' };
  const name = await targetNameOf(a);
  await notify(
    a.agentUserId,
    'agent_appointment_new_slot',
    `${name} propose un autre horaire : ${when(slot.day, slot.hour, slot.minute)}`,
    'Acceptez ce nouvel horaire ou annulez le rendez-vous dans votre calendrier.',
    id,
    AGENT_LINK,
  );
  await tellAdmins(
    `Nouvel horaire proposé par ${name} : ${when(slot.day, slot.hour, slot.minute)}`,
    a,
    name,
  );
  return { ok: true };
};

const nextDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Agent: accept the slot his affiliate proposed back. */
export const agentAcceptProposedSlot = async (
  agentUserId: string,
  id: string,
): Promise<TransitionResult> => {
  const a = await loadAppointment(id);
  if (!a || a.agentUserId !== agentUserId || a.initiatedBy !== 'agent') {
    return { ok: false, error: 'NOT_FOUND' };
  }
  if (a.status !== 'nouvel_horaire' || !a.proposedDay || a.proposedHour === null) {
    return { ok: false, error: 'BAD_STATE' };
  }
  const moved = {
    day: a.proposedDay,
    hour: a.proposedHour,
    minute: a.proposedMinute ?? 0,
  };
  try {
    const done = await setAppointmentStatus(id, ['nouvel_horaire'], {
      status: 'confirme',
      ...moved,
      proposedDay: null,
      proposedHour: null,
      proposedMinute: null,
    });
    if (done.length === 0) return { ok: false, error: 'BAD_STATE' };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'SLOT_TAKEN' };
    throw err;
  }
  const agentName = await userLabelById(agentUserId);
  await notify(
    a.affiliateUserId,
    'appointment_confirmed',
    `Votre rendez-vous ${when(moved.day, moved.hour, moved.minute)} est confirmé`,
    `${agentName} a accepté l’horaire que vous avez proposé.`,
    id,
    null,
  );
  const name = await targetNameOf(a);
  await tellAdmins(`Rendez-vous confirmé au nouvel horaire : ${name}`, { ...a, ...moved }, name);
  return { ok: true };
};

/** After a cancellation of an agent's own request (either side): the Toodooh team is told. */
export const noticeRdvCancelled = async (a: AgentAppointment, by: 'agent' | 'affilie') => {
  if (a.initiatedBy !== 'agent') return;
  const name = await targetNameOf(a);
  await tellAdmins(`Rendez-vous annulé par ${by === 'agent' ? 'l’agent' : name}`, a, name);
};
