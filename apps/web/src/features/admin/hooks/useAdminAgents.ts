import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type AffiliationAction,
  type AgentRoleKey,
  type AgentSheetPatch,
  adminAgentsService,
} from '@/features/admin/services/admin-agents.service';

import { adminKeys } from './queryKeys';

/** AGT-1 — every agent with its status and onboarding progress. */
export const useAgentsList = () =>
  useQuery({ queryKey: adminKeys.agentsAll(), queryFn: () => adminAgentsService.list() });

export const useAgentSheet = (id: string | null) =>
  useQuery({
    queryKey: adminKeys.agentSheet(id ?? ''),
    queryFn: () => adminAgentsService.get(id ?? ''),
    enabled: id !== null,
  });

export const useAgentAffiliations = (id: string) =>
  useQuery({
    queryKey: adminKeys.agentAffiliations(id),
    queryFn: () => adminAgentsService.affiliations(id),
  });

export const useAgentPayouts = (month: string) =>
  useQuery({
    queryKey: adminKeys.agentPayouts(month),
    queryFn: () => adminAgentsService.payouts(month),
  });

export const useAgentObjectives = () =>
  useQuery({
    queryKey: adminKeys.agentObjectives(),
    queryFn: () => adminAgentsService.objectives(),
  });

export const useAgentRibs = (status: 'en_attente' | 'valide' | 'refuse') =>
  useQuery({
    queryKey: adminKeys.agentRibs(status),
    queryFn: () => adminAgentsService.ribs(status),
  });

export const useAgentCge = () =>
  useQuery({ queryKey: adminKeys.agentCge(), queryFn: () => adminAgentsService.cge() });

/** Every agent mutation re-reads the whole agents page (list, sheets, queues). */
function useAgentsMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.agentsAll() });
    },
  });
}

export const usePatchAgent = () =>
  useAgentsMutation((v: { id: string; body: AgentSheetPatch }) =>
    adminAgentsService.patch(v.id, v.body),
  );

export const useSetAgentStatus = () =>
  useAgentsMutation((v: { id: string; status: 'actif' | 'suspendu' | 'cloture' }) =>
    adminAgentsService.setStatus(v.id, v.status),
  );

export const useResendAgentAccess = () =>
  useAgentsMutation((id: string) => adminAgentsService.resendAccess(id));

export const useDecideRib = () =>
  useAgentsMutation((v: { id: string; decision: 'valide' | 'refuse'; reason?: string }) =>
    v.decision === 'valide'
      ? adminAgentsService.validateRib(v.id)
      : adminAgentsService.refuseRib(v.id, v.reason ?? ''),
  );

export const usePublishCge = () =>
  useAgentsMutation((v: { role: AgentRoleKey; version: string; file: File }) =>
    adminAgentsService.publishCge(v.role, v.version, v.file),
  );

export const useAffiliationAction = () =>
  useAgentsMutation((v: { id: string; action: AffiliationAction }) =>
    adminAgentsService.affiliationAction(v.id, v.action),
  );

export const usePreparePayouts = () =>
  useAgentsMutation((month: string) => adminAgentsService.preparePayouts(month));

export const useMarkPayoutPaid = () =>
  useAgentsMutation((v: { id: string; transferDate: string }) =>
    adminAgentsService.markPayoutPaid(v.id, v.transferDate),
  );

export const useAddObjective = () =>
  useAgentsMutation((v: { role: AgentRoleKey; label: string }) =>
    adminAgentsService.addObjective(v.role, v.label),
  );

export const usePatchObjective = () =>
  useAgentsMutation((v: { id: string; body: Partial<{ label: string; active: boolean }> }) =>
    adminAgentsService.patchObjective(v.id, v.body),
  );
