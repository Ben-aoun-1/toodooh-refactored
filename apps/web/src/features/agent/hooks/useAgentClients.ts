import { useQuery } from '@tanstack/react-query';

import { agentClientsService } from '@/features/agent/services/agent-clients.service';

import { agentKeys } from './queryKeys';

/**
 * P2 — the caller agent's referred clients (GET /api/agent/clients). Read-only
 * server state; the role guard lives server-side (and in AgentRoute).
 */
export function useAgentClients() {
  return useQuery({
    queryKey: agentKeys.clients(),
    queryFn: () => agentClientsService.getClients(),
  });
}
