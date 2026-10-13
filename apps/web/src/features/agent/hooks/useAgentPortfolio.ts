import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentPortfolioService } from '@/features/agent/services/agent-portfolio.service';

import { agentKeys } from './queryKeys';

// AGT-4 — every page re-reads its data on open (spec §4 « Rafraîchissement »).

export const useAgentDashboard = () =>
  useQuery({
    queryKey: agentKeys.dashboard(),
    queryFn: () => agentPortfolioService.dashboard(),
    refetchOnMount: 'always',
  });

export const useAgentCampaigns = () =>
  useQuery({
    queryKey: agentKeys.campaigns(),
    queryFn: () => agentPortfolioService.campaigns(),
    refetchOnMount: 'always',
  });

export const useAgentAffiliates = () =>
  useQuery({
    queryKey: agentKeys.affiliates(),
    queryFn: () => agentPortfolioService.affiliates(),
    refetchOnMount: 'always',
  });

export const useAgentWallet = (enabled = true) =>
  useQuery({
    queryKey: agentKeys.wallet(),
    queryFn: () => agentPortfolioService.wallet(),
    enabled,
  });

export const useUploadPayoutInvoice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { payoutId: string; file: File }) =>
      agentPortfolioService.uploadInvoice(v.payoutId, v.file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.wallet() });
    },
  });
};

export const useShAgentCampaigns = () =>
  useQuery({
    queryKey: agentKeys.shCampaigns(),
    queryFn: () => agentPortfolioService.shCampaigns(),
    refetchOnMount: 'always',
  });

export const useShAgentAffiliates = () =>
  useQuery({
    queryKey: agentKeys.shAffiliates(),
    queryFn: () => agentPortfolioService.shAffiliates(),
    refetchOnMount: 'always',
  });

export const useAgentFollowup = () =>
  useQuery({
    queryKey: agentKeys.followup(),
    queryFn: () => agentPortfolioService.followup(),
    refetchOnMount: 'always',
  });

export const useFollowupSheet = (screenhostId: string | null) =>
  useQuery({
    queryKey: agentKeys.followupSheet(screenhostId ?? ''),
    queryFn: () => agentPortfolioService.followupSheet(screenhostId ?? ''),
    enabled: screenhostId !== null,
  });
