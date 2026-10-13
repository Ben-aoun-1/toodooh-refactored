import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// AGT-4 (spec §5 « Bascule de vue … mémorisée par agent ») — cards or table, per agent and page,
// persisted through Zustand persist (CLAUDE.md: the only localStorage path).

export type PortfolioView = 'cards' | 'table';
type ViewPage = 'campaigns' | 'affiliates';

interface AgentViewState {
  views: Record<string, PortfolioView>;
  setView: (agentId: string, page: ViewPage, view: PortfolioView) => void;
}

export const useAgentViewStore = create<AgentViewState>()(
  persist(
    (set) => ({
      views: {},
      setView: (agentId, page, view) =>
        set((s) => ({ views: { ...s.views, [`${agentId}:${page}`]: view } })),
    }),
    { name: 'toodooh-agent-views' },
  ),
);

export const viewOf = (
  views: Record<string, PortfolioView>,
  agentId: string | undefined,
  page: ViewPage,
): PortfolioView => views[`${agentId ?? ''}:${page}`] ?? 'cards';
