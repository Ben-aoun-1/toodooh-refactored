import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentOffersService } from '@/features/agent/services/agent-offers.service';

import { agentKeys } from './queryKeys';
import { AGENT_NOTIFICATIONS_KEY } from './useAgentNotifications';

// Agent Screenhost spec VF §10 — one offer (the window) and the agent's answer for the Host.

export const useAgentOffer = (id: string) =>
  useQuery({
    queryKey: agentKeys.offer(id),
    queryFn: () => agentOffersService.get(id),
    // The Host may answer while the window is open.
    refetchInterval: 15_000,
  });

export const useAnswerAgentOffer = (id: string) => {
  const queryClient = useQueryClient();
  const refresh = () => {
    for (const queryKey of [
      agentKeys.offer(id),
      AGENT_NOTIFICATIONS_KEY,
      agentKeys.shCampaigns(),
      agentKeys.dashboard(),
      agentKeys.followup(),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
  return useMutation({
    mutationFn: (accepted: boolean) =>
      accepted ? agentOffersService.accept(id) : agentOffersService.refuse(id),
    // A 409 (the Host answered first) also reloads the window into its answered state.
    onSettled: refresh,
  });
};
