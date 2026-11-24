import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentChecklistsService } from '@/features/agent/services/agent-checklists.service';

import { agentKeys } from './queryKeys';

// Agent Screenhost spec VF §11 — the agent's fiches and one fiche.

export const useChecklists = () =>
  useQuery({ queryKey: agentKeys.checklists(), queryFn: () => agentChecklistsService.list() });

export const useChecklist = (id: string) =>
  useQuery({
    queryKey: agentKeys.checklist(id),
    queryFn: () => agentChecklistsService.get(id),
    // The form owns the answers while it is open: never refetch over what is being typed.
    staleTime: Infinity,
    gcTime: 0,
  });

export function useChecklistMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: agentKeys.checklists() }),
  });
}
