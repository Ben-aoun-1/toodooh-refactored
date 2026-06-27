import { describe, expect, it } from 'vitest';

import {
  AGENT_DASHBOARD_PLACEHOLDER,
  agentAudienceLabels,
  agentCodeDisplay,
  agentKpiCards,
} from './agent-dashboard';

// R5 — the variant label selection (Screenhosts↔Screencasters) and the LIVE-vs-PLACEHOLDER KPI split.
describe('agentAudienceLabels — screenhost vs screencast wording', () => {
  it('screencast_agent → Screencasters wording throughout', () => {
    const l = agentAudienceLabels('screencast_agent');
    expect(l.noun).toBe('Screencasters');
    expect(l.affiliatesSection).toBe('Mes Screencasters affiliés');
    expect(l.affiliatesKpi).toBe('Screencasters affiliés');
    expect(l.impressionsKpi).toContain('Screencasters');
    expect(l.subtitle).toContain('Screencasters');
  });

  it('screenhost_agent → Screenhosts wording throughout', () => {
    const l = agentAudienceLabels('screenhost_agent');
    expect(l.noun).toBe('Screenhosts');
    expect(l.affiliatesSection).toBe('Mes Screenhosts affiliés');
    expect(l.affiliatesKpi).toBe('Screenhosts affiliés');
  });

  it.each([null, undefined, '', 'advertiser'])(
    'falls back to the Screenhost noun for a non-screencast role (%s)',
    (role) => {
      expect(agentAudienceLabels(role).noun).toBe('Screenhosts');
    },
  );
});

describe('agentKpiCards — LIVE vs PLACEHOLDER split', () => {
  const labels = agentAudienceLabels('screenhost_agent');

  it('exposes exactly four cards, with ONLY the affiliates card live', () => {
    const cards = agentKpiCards(3, labels);
    expect(cards).toHaveLength(4);
    expect(cards.filter((c) => c.live).map((c) => c.key)).toEqual(['affiliates']);
  });

  it('the affiliates card is the live clients.length', () => {
    const affiliates = agentKpiCards(7, labels).find((c) => c.key === 'affiliates');
    expect(affiliates?.value).toBe('7');
    expect(affiliates?.live).toBe(true);
  });

  it('a still-loading clients query (null) → affiliates shows the placeholder glyph but stays live', () => {
    const affiliates = agentKpiCards(null, labels).find((c) => c.key === 'affiliates');
    expect(affiliates?.value).toBe(AGENT_DASHBOARD_PLACEHOLDER);
    expect(affiliates?.live).toBe(true);
  });

  it('revenue, impressions and ranking are placeholders ("—", not live) — never fabricated', () => {
    const cards = agentKpiCards(3, labels);
    for (const key of ['revenue_total', 'impressions', 'ranking']) {
      const card = cards.find((c) => c.key === key);
      expect(card?.live).toBe(false);
      expect(card?.value).toBe(AGENT_DASHBOARD_PLACEHOLDER);
    }
  });
});

describe('agentCodeDisplay — code vs placeholder', () => {
  it('renders the agent code when present', () => {
    expect(agentCodeDisplay('SH123456')).toBe('SH123456');
    expect(agentCodeDisplay('SC000001')).toBe('SC000001');
  });

  it.each([null, undefined, '', '   '])(
    'renders the placeholder glyph when the code is absent/blank (%s)',
    (value) => {
      expect(agentCodeDisplay(value)).toBe(AGENT_DASHBOARD_PLACEHOLDER);
    },
  );
});
