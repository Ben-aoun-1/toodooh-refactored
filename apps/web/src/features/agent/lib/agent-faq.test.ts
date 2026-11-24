import { describe, expect, it } from 'vitest';

import { agentFaq } from './agent-faq';

describe('AGENT-VF — the agent FAQ', () => {
  it('has 11 questions for a Screenhost agent and 9 for a Screencaster agent', () => {
    expect(agentFaq('screenhost')).toHaveLength(11);
    expect(agentFaq('screencaster')).toHaveLength(9);
  });

  it('keeps each agent type in its own vocabulary, and writes no em dash', () => {
    const sc = agentFaq('screencaster')
      .map((q) => q.question + q.answer)
      .join(' ');
    const sh = agentFaq('screenhost')
      .map((q) => q.question + q.answer)
      .join(' ');
    expect(sc).not.toMatch(/Screenhost|établissement/);
    expect(sh).not.toMatch(/Screencaster/);
    expect(sc + sh).not.toContain('—');
  });

  it('says an agent can also book a rendez-vous himself', () => {
    for (const kind of ['screenhost', 'screencaster'] as const) {
      const rdv = agentFaq(kind).find((q) => q.question === 'Comment gérer mes rendez-vous ?');
      expect(rdv?.answer).toContain('Prendre un rendez-vous');
    }
  });
});
