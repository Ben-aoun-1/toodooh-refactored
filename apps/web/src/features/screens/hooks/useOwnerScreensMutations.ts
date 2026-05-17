import { useMutation, useQueryClient } from '@tanstack/react-query';

import { screensService } from '@/features/screens/services/screens.service';
import { supabase } from '@/lib/supabase';

import { screensKeys } from './queryKeys';

/**
 * OwnerScreens write mutations.
 *
 * - `toggleAutoAccept` — upserts the `screen_configurations.auto_accept_campaigns`
 *   flag (update if a config row exists, else insert a full default row).
 *   Invalidates only `ownerScreensData` — the auto-accept map lives there.
 * - `removeUnavailabilityPeriod` — deletes an unavailability period. Invalidates
 *   `screensKeys.all` (the period shows in both screens composites).
 */
export function useOwnerScreensMutations() {
  const queryClient = useQueryClient();

  const toggleAutoAccept = useMutation({
    mutationFn: async ({ screenId, newValue }: { screenId: string; newValue: boolean }) => {
      const { data: existing } = await supabase
        .from('screen_configurations')
        .select('screen_id')
        .eq('screen_id', screenId);

      if (existing && existing.length > 0) {
        const { error: updateError } = await supabase
          .from('screen_configurations')
          .update({ auto_accept_campaigns: newValue })
          .eq('screen_id', screenId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from('screen_configurations').insert({
          screen_id: screenId,
          auto_accept_campaigns: newValue,
          brightness_level: 100,
          volume_level: 50,
          auto_brightness: true,
          auto_volume: true,
          timezone: 'Africa/Tunis',
          language: 'fr',
          refresh_rate: 60,
          maintenance_mode: false,
        });
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: screensKeys.ownerScreensData() });
    },
  });

  const removeUnavailabilityPeriod = useMutation({
    mutationFn: (periodId: string) => screensService.deleteUnavailabilityPeriod(periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: screensKeys.all });
    },
  });

  return { toggleAutoAccept, removeUnavailabilityPeriod };
}
