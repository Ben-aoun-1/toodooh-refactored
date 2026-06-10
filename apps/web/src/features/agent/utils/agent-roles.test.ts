import { describe, expect, it } from 'vitest';

import { agentRoleLabel, isAgentRole } from './agent-roles';

// P2 routing matrix — both agent roles (and ONLY them) are admitted to /agent.
describe('isAgentRole', () => {
  it('admits screenhost_agent', () => {
    expect(isAgentRole('screenhost_agent')).toBe(true);
  });

  it('admits screencast_agent', () => {
    expect(isAgentRole('screencast_agent')).toBe(true);
  });

  it.each(['admin', 'superadmin', 'advertiser', 'screen_owner', '', null, undefined])(
    'rejects %s',
    (role) => {
      expect(isAgentRole(role)).toBe(false);
    },
  );
});

describe('agentRoleLabel', () => {
  it('labels screenhost_agent as Agent ScreenHost', () => {
    expect(agentRoleLabel('screenhost_agent')).toBe('Agent ScreenHost');
  });

  it('labels screencast_agent as Agent ScreenCast', () => {
    expect(agentRoleLabel('screencast_agent')).toBe('Agent ScreenCast');
  });
});
