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

/**
 * CF-M2/FCT1 — the presigned recharge-file URLs for the review modal (justificatif, generated
 * bon, signed bon). Fetched only while the modal is open on a row that carries the file; the URL
 * is short-TTL (300s server-side), so nothing is cached: every open presigns fresh
 * (staleTime 0 / gcTime 0) and an expired link can never be reused.
 */
const usePresignedRechargeFile = (
  key: readonly unknown[],
  fetcher: () => Promise<{ url: string }>,
  enabled: boolean,
) => {
  const query = useQuery({
    queryKey: key,
    queryFn: fetcher,
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return {
    url: query.data?.url,
    loading: query.isLoading,
    isError: query.isError,
  };
};

export function useRechargeDocumentUrl(rechargeId: string | undefined, enabled: boolean) {
  return usePresignedRechargeFile(
    adminKeys.rechargeDocumentUrl(rechargeId ?? ''),
    () => adminRechargesService.documentUrl(rechargeId ?? ''),
    enabled && !!rechargeId,
  );
}

export function useRechargeBonUrl(rechargeId: string | undefined, enabled: boolean) {
  return usePresignedRechargeFile(
    adminKeys.rechargeBonUrl(rechargeId ?? ''),
    () => adminRechargesService.bonUrl(rechargeId ?? ''),
    enabled && !!rechargeId,
  );
}

export function useRechargeSignedBonUrl(rechargeId: string | undefined, enabled: boolean) {
  return usePresignedRechargeFile(
    adminKeys.rechargeSignedBonUrl(rechargeId ?? ''),
    () => adminRechargesService.signedBonUrl(rechargeId ?? ''),
    enabled && !!rechargeId,
  );
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
 * CF-M1 — the advertiser-side keys a confirm/reject must reach, pinned as a pure list (tested):
 * the LIVE wallet keys (balance + recharges — the ledger and factures derive from these) and the
 * dashboard stats (its balance leg is the same live read). These replaced the dead
 * walletKeys.transactions Supabase key at the money-flow repoint.
 */
export const rechargeDecisionInvalidationKeys = (advertiserId: string) => [
  walletKeys.balance(advertiserId),
  walletKeys.recharges(advertiserId),
  advertiserKeys.dashboardStats(advertiserId),
];

/**
 * Confirm / reject mutations.
 *
 * CF-14 invalidation graph — a confirm reaching `confirmed` credits the
 * advertiser's derived balance, so it reaches two other features: the admin
 * recharge list (intra) AND the advertiser's LIVE wallet keys + dashboard
 * balance (cross-feature, keyed by the recharge's advertiser_id). A reject
 * flips the row's status (visible in the advertiser's recharges/factures
 * list), so it reaches the same advertiser keys — balance included is
 * harmless (a reject never credits).
 */
export function useRechargeMutations() {
  const queryClient = useQueryClient();
  const invalidateRechargeList = () =>
    queryClient.invalidateQueries({ queryKey: adminKeys.rechargesAll() });
  const invalidateAdvertiserMoney = (advertiserId: string) => {
    for (const key of rechargeDecisionInvalidationKeys(advertiserId)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const confirmRecharge = useMutation({
    mutationFn: (id: string) => adminRechargesService.confirm(id),
    onSuccess: (updated: AdminRecharge) => {
      invalidateRechargeList();
      invalidateAdvertiserMoney(updated.advertiser_id);
    },
  });

  const rejectRecharge = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminRechargesService.reject(id, reason),
    onSuccess: (updated: AdminRecharge) => {
      invalidateRechargeList();
      invalidateAdvertiserMoney(updated.advertiser_id);
    },
  });

  return { confirmRecharge, rejectRecharge };
}
