import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminRechargesService,
  type AdminRecharge,
} from '@/features/admin/services/admin-recharges.service';
import { adminUserService } from '@/features/admin/services/admin-user.service';
import { advertiserKeys } from '@/features/advertiser/hooks/queryKeys';
import { walletKeys } from '@/features/wallet/hooks/queryKeys';

import { adminKeys } from './queryKeys';

/**
 * The FULL recharge moderation queue (newest first) from GET /api/admin/recharges.
 * The page filters/searches/paginates + derives the stat cards client-side over
 * this one list (the endpoint has no pagination/search/stats of its own).
 */
export function useAdminRecharges() {
  const query = useQuery({
    queryKey: adminKeys.rechargesAll(),
    queryFn: () => adminRechargesService.list(),
  });
  return {
    recharges: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export interface AdvertiserIdentity {
  business_name: string;
  email: string;
}

/**
 * Advertiser-identity map for enriching recharge rows (the view carries only
 * advertiser_id). Sourced from the EXISTING admin users endpoint
 * (GET /api/admin/users?status=approved), filtered to advertisers.
 */
export function useAdvertiserIdentities(): Map<string, AdvertiserIdentity> {
  const query = useQuery({
    queryKey: [...adminKeys.all, 'advertiserIdentities'] as const,
    queryFn: async () => {
      const users = await adminUserService.getUsersByStatus('approved');
      const map = new Map<string, AdvertiserIdentity>();
      for (const u of users) {
        if (u.profile_type === 'advertiser') {
          map.set(u.id, { business_name: u.business_name, email: u.email });
        }
      }
      return map;
    },
  });
  return query.data ?? new Map<string, AdvertiserIdentity>();
}

/**
 * Confirm / reject mutations.
 *
 * CF-14 invalidation graph — a confirm reaching `confirmed` credits the
 * advertiser's derived balance, so it reaches two other features: the admin
 * recharge list (intra) AND the advertiser's wallet ledger +
 * dashboard balance (cross-feature, keyed by the recharge's advertiser_id).
 * A reject changes nothing the advertiser's balance/ledger shows (those count
 * only confirmed rows) — recharge list only.
 */
export function useRechargeMutations() {
  const queryClient = useQueryClient();
  const invalidateRechargeList = () =>
    queryClient.invalidateQueries({ queryKey: adminKeys.rechargesAll() });
  const invalidateAdvertiserBalance = (advertiserId: string) => {
    queryClient.invalidateQueries({ queryKey: walletKeys.transactions(advertiserId) });
    queryClient.invalidateQueries({ queryKey: advertiserKeys.dashboardStats(advertiserId) });
  };

  const confirmRecharge = useMutation({
    mutationFn: (id: string) => adminRechargesService.confirm(id),
    onSuccess: (updated: AdminRecharge) => {
      invalidateRechargeList();
      invalidateAdvertiserBalance(updated.advertiser_id);
    },
  });

  const rejectRecharge = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminRechargesService.reject(id, reason),
    onSuccess: invalidateRechargeList,
  });

  return { confirmRecharge, rejectRecharge };
}
