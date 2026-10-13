import { describe, expect, it } from 'vitest';

import type { AgentNotification } from '../services/agent-notifications.service';

import {
  relativeFr,
  showsAppointmentActions,
  sortNotifications,
  unreadCount,
} from './agent-notifications';

const n = (over: Partial<AgentNotification>): AgentNotification => ({
  id: 'n',
  type: 'agent_affiliate_new',
  title: 't',
  body: 'b',
  campaign_id: null,
  link: null,
  appointment_id: null,
  appointment_status: null,
  read_at: null,
  created_at: '2026-10-13T10:00:00Z',
  ...over,
});

describe('AGT-6 — the agent bell', () => {
  it('relative French timestamps', () => {
    expect(relativeFr('2026-10-13T09:52:00Z', new Date('2026-10-13T10:00:00Z'))).toBe(
      'il y a 8 minutes',
    );
  });

  it('newest first, unread count', () => {
    const rows = [
      n({ id: 'a', created_at: '2026-10-12T10:00:00Z' }),
      n({ id: 'b', read_at: '2026-10-13T10:00:00Z' }),
    ];
    expect(sortNotifications(rows).map((r) => r.id)).toEqual(['b', 'a']);
    expect(unreadCount(rows)).toBe(1);
  });

  it('appointment actions only while the request waits', () => {
    const req = n({
      type: 'agent_appointment_requested',
      appointment_id: 'x',
      appointment_status: 'en_attente',
    });
    expect(showsAppointmentActions(req)).toBe(true);
    expect(showsAppointmentActions({ ...req, appointment_status: 'confirme' })).toBe(false);
    expect(showsAppointmentActions({ ...req, type: 'agent_appointment_reminder' })).toBe(false);
  });
});
