// R5 — the agent dashboard view-model (Figma alignment). Two near-identical role variants share one
// layout; the only data differences are (a) the Screenhosts↔Screencasters wording swap and (b) which
// metrics are LIVE today vs greenfield PLACEHOLDERS. Both are kept here as PURE functions so they are
// unit-tested; the JSX layout itself is build-verified (the web suite has no render harness).
//
// HONEST PLACEHOLDERS (CF-18): everything greenfield — revenue/wallet, campaigns, impressions,
// ranking, appointments, notifications — renders an explicit "à venir" with NO fabricated number.
// Only what an existing API already returns is LIVE (the affiliated-clients count, from
// GET /api/agent/clients; the header name, from the session).

export const AGENT_DASHBOARD_PLACEHOLDER = '—';

// The wording bundle for one agent role. A screenhost_agent refers screen OWNERS ("Screenhosts");
// a screencast_agent refers advertisers ("Screencasters"). One source of truth so the dashboard and
// the sidebar can't drift. Anything that is not screencast_agent falls back to the Screenhost noun.
export interface AgentAudienceLabels {
  noun: string;
  affiliatesSection: string;
  affiliatesKpi: string;
  impressionsKpi: string;
  subtitle: string;
}

export function agentAudienceLabels(role: string | null | undefined): AgentAudienceLabels {
  const noun = role === 'screencast_agent' ? 'Screencasters' : 'Screenhosts';
  return {
    noun,
    affiliatesSection: `Mes ${noun} affiliés`,
    affiliatesKpi: `${noun} affiliés`,
    impressionsKpi: `Impressions totales générées par vos ${noun} affiliés`,
    subtitle: `Suivez l'activité de vos ${noun} affiliés et les campagnes actuellement diffusées et consultez vos revenus.`,
  };
}

// A KPI card descriptor. `live` marks a metric wired to a real source (it shows a value, never the
// "Bientôt disponible" caption) — independent of whether that value has resolved yet (a still-loading
// live count shows the placeholder glyph but is NOT captioned "Bientôt disponible").
export interface AgentKpiCard {
  key: string;
  label: string;
  value: string;
  live: boolean;
}

// The four KPI cards. Only "{noun} affiliés = clients.length" is LIVE; revenue, impressions and
// ranking are greenfield → explicit placeholders. `clientCount` is null while the clients query is
// loading/errored — the affiliates card stays live but shows the placeholder glyph until it resolves.
export function agentKpiCards(
  clientCount: number | null,
  labels: AgentAudienceLabels,
): AgentKpiCard[] {
  return [
    {
      key: 'revenue_total',
      label: 'Revenus totaux',
      value: AGENT_DASHBOARD_PLACEHOLDER,
      live: false,
    },
    {
      key: 'affiliates',
      label: labels.affiliatesKpi,
      value: clientCount === null ? AGENT_DASHBOARD_PLACEHOLDER : String(clientCount),
      live: true,
    },
    {
      key: 'impressions',
      label: labels.impressionsKpi,
      value: AGENT_DASHBOARD_PLACEHOLDER,
      live: false,
    },
    {
      key: 'ranking',
      label: 'Classement de performance Agent',
      value: AGENT_DASHBOARD_PLACEHOLDER,
      live: false,
    },
  ];
}
