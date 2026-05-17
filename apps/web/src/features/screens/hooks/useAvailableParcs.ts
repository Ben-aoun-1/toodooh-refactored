import { useQuery } from '@tanstack/react-query';

import type { ParcTV } from '@/features/campaigns/hooks/new-campaign/wizard-types';
import { supabase } from '@/lib/supabase';

import { screensKeys } from './queryKeys';

/**
 * Owners exposing active screens, shaped as TV-park (`ParcTV`) options for the
 * campaign wizard's `parc_tv` diffusion mode (`NewCampaign`).
 *
 * Commit 7b — folded in from 7a's CF-10 §5.1. The dominant table is `screens`,
 * so per D6 the read lands under `features/screens/hooks/` even though its
 * consumer is a campaigns page. Wraps the existing raw-Supabase path (D4); the
 * owner-grouping transform stays inside the queryFn (composite-read principle).
 */
interface UseAvailableParcsOptions {
  /** Gate the fetch — the wizard only needs parcs in `parc_tv` diffusion mode. */
  enabled?: boolean;
}

export function useAvailableParcs({ enabled = true }: UseAvailableParcsOptions = {}): {
  parcs: ParcTV[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: screensKeys.availableParcs(),
    enabled,
    queryFn: async (): Promise<ParcTV[]> => {
      const { data: screens } = await supabase
        .from('screens')
        .select('id, owner_id')
        .eq('status', 'active');

      if (!screens || screens.length === 0) return [];

      const ownerScreenMap = new Map<string, string[]>();
      screens.forEach((screen: { id: string; owner_id: string }) => {
        const list = ownerScreenMap.get(screen.owner_id) || [];
        list.push(screen.id);
        ownerScreenMap.set(screen.owner_id, list);
      });

      const ownerIds = [...ownerScreenMap.keys()];
      const { data: owners } = await supabase
        .from('business_profiles')
        .select('user_id, business_name, logo_url')
        .in('user_id', ownerIds);

      return ownerIds
        .map((ownerId): ParcTV => {
          const profile = (owners || []).find(
            (owner: { user_id: string }) => owner.user_id === ownerId,
          );
          return {
            ownerId,
            name: profile?.business_name || 'Parc inconnu',
            logo: profile?.logo_url || undefined,
            screenCount: ownerScreenMap.get(ownerId)?.length || 0,
            screenIds: ownerScreenMap.get(ownerId) || [],
          };
        })
        .filter((parc) => parc.screenCount > 0);
    },
  });

  return {
    parcs: query.data ?? [],
    loading: query.isLoading,
  };
}
