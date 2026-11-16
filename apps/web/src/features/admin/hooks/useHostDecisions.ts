import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type HostDecisionKind,
  adminHostDecisionsService,
} from '@/features/admin/services/admin-host-decisions.service';

import { adminKeys } from './queryKeys';

/** Mariem 13/11 — a campaign's Hosts and their answers, fetched when the panel opens. */
export function useHostDecisions(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.campaignHostDecisions(campaignId),
    queryFn: () => adminHostDecisionsService.list(campaignId),
    enabled,
  });
}

/** Answer for one Host; a refusal may cascade the share to other Hosts, so the list refetches. */
export function useDecideForHost(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      kind: HostDecisionKind;
      allocationId: string;
      answer: 'accept' | 'refuse';
    }) => adminHostDecisionsService.decide(v.kind, v.allocationId, v.answer),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: adminKeys.campaignHostDecisions(campaignId),
      });
      void queryClient.invalidateQueries({
        queryKey: adminKeys.campaignEligibleHosts(campaignId),
      });
    },
  });
}
