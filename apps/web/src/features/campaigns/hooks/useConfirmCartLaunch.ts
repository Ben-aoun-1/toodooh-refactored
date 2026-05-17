import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { advertiserKeys } from '@/features/advertiser/hooks/queryKeys';
import { campaignService } from '@/features/campaigns/services/campaign.service';
import type { CartItem } from '@/features/campaigns/stores/cart.store';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import { supabase } from '@/lib/supabase';
import { balanceService } from '@/services/balance.service';

import { campaignsKeys } from './queryKeys';

interface ConfirmCartInput {
  items: CartItem[];
  userId: string;
}

/** Per-status tallies + the cart items still pending after a confirm run. */
export interface ConfirmCartResult {
  remainingItems: CartItem[];
  activatedCount: number;
  pendingCount: number;
  insufficientCount: number;
  failedCount: number;
  hasInsufficientUnvalidated: boolean;
}

/**
 * `CartPage` — confirm-and-launch the cart's campaigns (Commit 7a).
 *
 * The whole per-item loop is one mutationFn (one unit of work, not one
 * mutation per row): for each campaign it re-reads the row, resolves video
 * validation + balance, writes the resulting status, and — for activations —
 * injects the publication schedule. It returns pure tallies; `CartPage` keeps
 * the UI orchestration (cart pruning, toasts, modals, navigation) in the
 * component, behaviour-identical to the pre-migration handler.
 *
 * CF-14 invalidation graph — a confirm run activates / advances campaigns:
 * - (a) within-session — `campaignsKeys.all`: the advertiser's `MyCampaigns`
 *   list (Commit 7b reader; prefix-invalidated forward-compatibly).
 * - (a) within-session — `advertiserKeys.all`: the dashboard's balance,
 *   `dashboardStats`, and `lastCampaigns` reads (balance is debited on
 *   activation — money-adjacent, CLAUDE.md rule 10).
 * - (b) cross-session cross-role — `adminKeys.monitoringCampaigns()` /
 *   `monitoringStats()`: admin `CampaignMonitoring` sees the activations.
 * - (b) cross-session cross-role — `screenhostKeys.all`: each owner whose
 *   screens were selected gets a pending approval entry / campaign-overview
 *   change (`injectCampaignPublicationSchedule` writes the auto-approvals).
 *   No-op against uncached owner sessions; kept for intent — real freshness
 *   rides the owner consumer's `staleTime`.
 */
export function useConfirmCartLaunch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ items, userId }: ConfirmCartInput): Promise<ConfirmCartResult> => {
      const remainingItems: CartItem[] = [];
      let activatedCount = 0;
      let pendingCount = 0;
      let insufficientCount = 0;
      let failedCount = 0;
      let hasInsufficientUnvalidated = false;

      for (const item of items) {
        try {
          const { data: campaignRow, error: campaignError } = await supabase
            .from('campaigns')
            .select('id, user_id, status, video_id, content_validation_status')
            .eq('id', item.id)
            .eq('user_id', userId)
            .single();

          if (campaignError || !campaignRow) {
            failedCount += 1;
            remainingItems.push(item);
            continue;
          }

          // Déjà active: la conserver telle quelle et retirer du panier.
          if (campaignRow.status === 'active') {
            activatedCount += 1;
            continue;
          }

          let videoIsValidated = campaignRow.content_validation_status === 'approved';
          if (!videoIsValidated && campaignRow.video_id) {
            const { data: videoRow } = await supabase
              .from('videos')
              .select('validation_status')
              .eq('id', campaignRow.video_id)
              .single();
            videoIsValidated = videoRow?.validation_status === 'approved';
          }

          const balanceCheck = await balanceService.checkCampaignBalance(item.id);
          const hasSufficientBalance = Boolean(balanceCheck?.has_sufficient_balance);

          // Règle métier: vidéo non validée + solde insuffisant => brouillon + message + redirection recharge.
          if (!videoIsValidated && !hasSufficientBalance) {
            const { error: setDraftError } = await supabase
              .from('campaigns')
              .update({
                status: 'draft',
                content_validation_status: 'pending',
              })
              .eq('id', item.id)
              .eq('user_id', userId);

            if (setDraftError) {
              failedCount += 1;
              remainingItems.push(item);
              continue;
            }

            insufficientCount += 1;
            hasInsufficientUnvalidated = true;
            remainingItems.push(item);
            continue;
          }

          if (!hasSufficientBalance) {
            insufficientCount += 1;
            remainingItems.push(item);
            continue;
          }

          const nextStatus = videoIsValidated ? 'active' : 'pending';

          const { error: updateError } = await supabase
            .from('campaigns')
            .update({
              status: nextStatus,
              content_validation_status: videoIsValidated ? 'approved' : 'pending',
            })
            .eq('id', item.id)
            .eq('user_id', userId);

          if (updateError) {
            failedCount += 1;
            remainingItems.push(item);
            continue;
          }

          if (nextStatus === 'active') {
            await campaignService.injectCampaignPublicationSchedule(item.id);
            activatedCount += 1;
          } else {
            pendingCount += 1;
          }
        } catch {
          failedCount += 1;
          remainingItems.push(item);
        }
      }

      return {
        remainingItems,
        activatedCount,
        pendingCount,
        insufficientCount,
        failedCount,
        hasInsufficientUnvalidated,
      };
    },
    onSuccess: () => {
      // (a) advertiser-owned views — same session.
      queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
      queryClient.invalidateQueries({ queryKey: advertiserKeys.all });
      // (b) admin + screenhost — cross-session, no-ops here, kept for intent.
      queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
      queryClient.invalidateQueries({ queryKey: adminKeys.monitoringStats() });
      queryClient.invalidateQueries({ queryKey: screenhostKeys.all });
    },
  });
}
