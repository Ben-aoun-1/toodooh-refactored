import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminRechargesService,
  type RechargeStats,
} from '@/features/admin/services/admin-recharges.service';
import { advertiserKeys } from '@/features/advertiser/hooks/queryKeys';
import { walletKeys } from '@/features/wallet/hooks/queryKeys';
import { supabase } from '@/lib/supabase';

import { adminKeys } from './queryKeys';

export interface RechargeFilters {
  status: string;
  search: string;
  page: number;
  perPage: number;
}

/** Paginated, filtered recharge list. Filters live in the key — changing one refetches. */
export function useRecharges(filters: RechargeFilters) {
  const query = useQuery({
    queryKey: adminKeys.recharges(filters.status, filters.search, filters.page, filters.perPage),
    queryFn: () =>
      adminRechargesService.getRecharges(
        { status: filters.status, search: filters.search },
        filters.page,
        filters.perPage,
      ),
  });

  return {
    recharges: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/** Global recharge counters for the stat cards. */
export function useRechargeStats(): { stats: RechargeStats | undefined; isError: boolean } {
  const query = useQuery({
    queryKey: adminKeys.rechargeStats(),
    queryFn: () => adminRechargesService.getRechargeStats(),
  });
  return { stats: query.data, isError: query.isError };
}

interface RechargeAdvertiser {
  user_id: string;
  business_name: string;
  email: string;
}

/** Approved-advertiser picker for the manual-recharge form. */
export function useRechargeAdvertisers(): { advertisers: RechargeAdvertiser[] } {
  const query = useQuery({
    queryKey: adminKeys.rechargeAdvertisers(),
    queryFn: async (): Promise<RechargeAdvertiser[]> => {
      const { data, error } = await supabase
        .from('business_profiles')
        .select('user_id, business_name, email')
        .eq('profile_type', 'advertiser')
        .eq('status', 'approved')
        .order('business_name');
      if (error) throw error;
      return (data ?? []) as RechargeAdvertiser[];
    },
  });
  return { advertisers: query.data ?? [] };
}

interface ApproveRechargeInput {
  rechargeId: string;
  adminId: string;
  /** The recharge owner's user_id — needed for the cross-feature invalidation. */
  advertiserUserId: string;
  notes?: string;
}

interface RejectRechargeInput {
  rechargeId: string;
  adminId: string;
  reason: string;
}

interface CreateRechargeInput {
  userId: string;
  amount: number;
  paymentMethod: 'card' | 'bank' | 'cash';
  description: string;
  autoValidate: boolean;
  adminId: string;
  adminFullName: string;
}

/**
 * Recharge write mutations.
 *
 * CF-14 invalidation graph — a recharge reaching `completed` raises the
 * advertiser's balance, so the graph reaches two other features:
 * - `approveRecharge` → `adminKeys.recharges*` + `rechargeStats` (intra) **and**
 *   `walletKeys.transactions(advertiserUserId)` + `advertiserKeys.dashboardStats(
 *   advertiserUserId)` (cross-feature — the advertiser's wallet ledger shows
 *   the now-completed recharge and the dashboard balance moves).
 * - `rejectRecharge` → recharge list + stats only. The advertiser's wallet
 *   ledger filters to `status = 'completed'` and the balance counts only
 *   completed recharges, so a `pending → rejected` transition changes nothing
 *   the advertiser sees — no cross-feature key (CF-14: invalidate only keys
 *   whose user-visible data changes).
 * - `createRecharge` → list + stats always; the cross-feature pair only when
 *   `autoValidate` makes the new row land `completed`.
 */
export function useRechargeMutations() {
  const queryClient = useQueryClient();

  const invalidateAdvertiserBalance = (advertiserUserId: string) => {
    queryClient.invalidateQueries({ queryKey: walletKeys.transactions(advertiserUserId) });
    queryClient.invalidateQueries({ queryKey: advertiserKeys.dashboardStats(advertiserUserId) });
  };
  const invalidateRechargeViews = () => {
    queryClient.invalidateQueries({ queryKey: adminKeys.rechargesAll() });
    queryClient.invalidateQueries({ queryKey: adminKeys.rechargeStats() });
  };

  const approveRecharge = useMutation({
    mutationFn: ({ rechargeId, adminId, notes }: ApproveRechargeInput) =>
      adminRechargesService.approveRecharge(rechargeId, adminId, notes),
    onSuccess: (_result, { advertiserUserId }) => {
      invalidateRechargeViews();
      invalidateAdvertiserBalance(advertiserUserId);
    },
  });

  const rejectRecharge = useMutation({
    mutationFn: ({ rechargeId, adminId, reason }: RejectRechargeInput) =>
      adminRechargesService.rejectRecharge(rechargeId, adminId, reason),
    onSuccess: invalidateRechargeViews,
  });

  const createRecharge = useMutation({
    mutationFn: async (input: CreateRechargeInput) => {
      const { error } = await supabase
        .from('recharges')
        .insert({
          user_id: input.userId,
          amount: input.amount,
          payment_method: input.paymentMethod,
          status: input.autoValidate ? 'completed' : 'pending',
          description: input.description || `Recharge manuelle par ${input.adminFullName}`,
          validated_by: input.autoValidate ? input.adminId : null,
          validated_at: input.autoValidate ? new Date().toISOString() : null,
          validation_notes: input.autoValidate
            ? 'Validation automatique lors de la création'
            : null,
        })
        .select()
        .single();
      if (error) throw error;
    },
    onSuccess: (_result, input) => {
      invalidateRechargeViews();
      if (input.autoValidate) invalidateAdvertiserBalance(input.userId);
    },
  });

  return { approveRecharge, rejectRecharge, createRecharge };
}
