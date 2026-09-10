import { beforeEach, describe, expect, it } from 'vitest';

import {
  AGENT_INVITE_TTL_MS,
  clearAgentInvites,
  parkAgentInvite,
  takeAgentInvite,
} from '../src/lib/agent-invite.js';

// SET-PW1 — the handoff that lets ONE email carry a real reset token. The rules that matter are
// single-consumption and expiry: either failure would render an agent's code + temp password into
// a LATER, unrelated password-reset email for the same address.

const invite = { agentCode: 'SH/123456', tempPassword: 'Temp-Passw0rd', name: 'Agent Un' };

describe('the agent invite handoff', () => {
  beforeEach(() => clearAgentInvites());

  it('hands the parked invite to the next reset email for that address', () => {
    parkAgentInvite('agent@example.com', invite);
    expect(takeAgentInvite('agent@example.com')).toEqual(invite);
  });

  it('is consumed exactly once — a second reset renders the ORDINARY template', () => {
    parkAgentInvite('agent@example.com', invite);
    expect(takeAgentInvite('agent@example.com')).toEqual(invite);
    expect(takeAgentInvite('agent@example.com')).toBeNull();
  });

  it('never leaks into an unrelated address', () => {
    parkAgentInvite('agent@example.com', invite);
    expect(takeAgentInvite('someone-else@example.com')).toBeNull();
  });

  it('matches the address case-insensitively, as better-auth lower-cases it', () => {
    parkAgentInvite('Agent@Example.COM', invite);
    expect(takeAgentInvite('agent@example.com')).toEqual(invite);
  });

  it('expires rather than waiting forever for a send that never came', () => {
    const t0 = 1_000_000;
    parkAgentInvite('agent@example.com', invite, t0);
    expect(takeAgentInvite('agent@example.com', t0 + AGENT_INVITE_TTL_MS + 1)).toBeNull();
  });

  it('returns null for an address that was never invited', () => {
    expect(takeAgentInvite('nobody@example.com')).toBeNull();
  });
});
