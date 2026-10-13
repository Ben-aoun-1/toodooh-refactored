import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type AgentProfilePatch,
  agentAccountService,
} from '@/features/agent/services/agent-account.service';

import { agentKeys } from './queryKeys';

/** AGT-1 — status, CGE in force, onboarding and RIB; re-read on every page open (spec §4). */
export const useAgentAccount = () =>
  useQuery({
    queryKey: agentKeys.account(),
    queryFn: () => agentAccountService.account(),
    refetchOnMount: 'always',
  });

export const useAgentProfile = (enabled = true) =>
  useQuery({
    queryKey: agentKeys.profile(),
    queryFn: () => agentAccountService.profile(),
    enabled,
  });

/** Every account mutation re-reads the whole agent feature (onboarding, profile, data). */
function useAgentMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export const usePatchAgentProfile = () =>
  useAgentMutation((body: AgentProfilePatch) => agentAccountService.patchProfile(body));
export const useUploadAgentPhoto = () =>
  useAgentMutation((file: File) => agentAccountService.uploadPhoto(file));
export const useDeleteAgentPhoto = () => useAgentMutation(() => agentAccountService.deletePhoto());
export const useAgentPrefs = () =>
  useAgentMutation((v: { news: boolean; reminders: boolean }) =>
    agentAccountService.setPrefs(v.news, v.reminders),
  );
export const useAcceptCge = () =>
  useAgentMutation((id: string) => agentAccountService.acceptCge(id));
export const useUploadAgentRib = () =>
  useAgentMutation((file: File) => agentAccountService.uploadRib(file));
