import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminCreativesService } from '@/features/admin/services/admin-creatives.service';
import type { AdminCreativeView, CreativeStatusFilter } from '@/features/admin/types/creative';

import { adminKeys } from './queryKeys';

/** The admin creative-moderation list, filtered by status. */
export function useAdminCreatives(status: CreativeStatusFilter): {
  creatives: AdminCreativeView[];
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: adminKeys.creatives(status),
    queryFn: () => adminCreativesService.list(status),
  });
  return {
    creatives: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

interface ApproveInput {
  id: string;
  notes?: string;
}
interface RejectInput {
  id: string;
  notes: string;
}

/**
 * Approve / reject mutations for the NEW creatives pipeline. Unlike the legacy video service (which
 * returns a boolean) these throw ApiError on failure — the page branches in its try/catch. On
 * success we invalidate the creatives-list prefix (every status variant) AND the DERIVED views the
 * content gate feeds: the platform-stats composite + the admin campaign-monitoring list/stats — a
 * creative flip changes a campaign's derived `content_validation_status` (routes/campaigns.ts), so
 * those reads must refetch. This approve is a PURE status flip; it does NOT run the legacy
 * auto-activation cascade (by design: campaign activation/content gate is derived, not a side-write).
 */
export function useAdminCreativeMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: adminKeys.creativesAll() });
    queryClient.invalidateQueries({ queryKey: adminKeys.platformStats() });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringStats() });
  };

  const approve = useMutation({
    mutationFn: ({ id, notes }: ApproveInput) => adminCreativesService.approve(id, notes),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: ({ id, notes }: RejectInput) => adminCreativesService.reject(id, notes),
    onSuccess: invalidate,
  });

  return { approve, reject };
}
