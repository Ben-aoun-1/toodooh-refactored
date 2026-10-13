import { formatDistance } from 'date-fns';
import { fr } from 'date-fns/locale';

import type { AgentNotification } from '../services/agent-notifications.service';

// AGT-6 (agent specs v1.0 §8 « Comportement du panneau ») — the bell's rules, pure.

/** « il y a 8 minutes » (relative to `now`, injectable for tests). */
export const relativeFr = (iso: string, now: Date = new Date()): string =>
  formatDistance(new Date(iso), now, { addSuffix: true, locale: fr });

/** Newest first. */
export const sortNotifications = (rows: AgentNotification[]) =>
  [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

export const unreadCount = (rows: AgentNotification[]) => rows.filter((r) => !r.read_at).length;

/** A request still waiting for the agent shows Accepter / Proposer; a treated one shows none. */
export const showsAppointmentActions = (n: AgentNotification) =>
  n.type === 'agent_appointment_requested' &&
  n.appointment_id !== null &&
  n.appointment_status === 'en_attente';
