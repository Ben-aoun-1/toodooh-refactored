import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { type AgentLogo, agentLogosService } from '@/features/agent/services/agent-logos.service';

import { agentKeys } from './queryKeys';

// Agent specs VF « Logos » — every logo the agent's pages show, read once and looked up by id.

export function useAgentLogos() {
  const q = useQuery({ queryKey: agentKeys.logos(), queryFn: () => agentLogosService.all() });
  return {
    /** The logo of a venue (by venue id) or of a Screencaster (by account id). */
    of: (id: string | null | undefined): AgentLogo | undefined =>
      id ? q.data?.subjects[id] : undefined,
    /** The advertiser's logo of a campaign. */
    ofCampaign: (id: string): AgentLogo | undefined => q.data?.campaigns[id],
  };
}

export function useUploadAgentLogo(subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => agentLogosService.upload(subjectId, file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: agentKeys.logos() }),
  });
}
