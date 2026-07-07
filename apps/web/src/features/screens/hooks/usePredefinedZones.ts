import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  predefinedZonesService,
  type PredefinedZone,
} from '@/features/screens/services/predefined-zones.service';

import { screensKeys } from './queryKeys';

/**
 * Predefined geographic zones — the canonical read.
 *
 * The `queryFn` calls `getAllForAdmin()` (every zone, active and inactive):
 * one cache entry keyed `screensKeys.predefinedZones()` then serves both
 * consumers. `GeographicZonesManagement` (admin, Commit 6c) renders the full
 * set; `NewCampaign`'s wizard (campaigns, Commit 7a) filters to active zones
 * at render. This is the brief §8 locked default — render-time active
 * filtering is cheap and aligns with D4 (wrap the existing data path).
 */
export function usePredefinedZones(): {
  zones: PredefinedZone[];
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: screensKeys.predefinedZones(),
    queryFn: () => predefinedZonesService.getAllForAdmin(),
  });
  return {
    zones: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Admin alias of {@link usePredefinedZones}, kept for the existing
 * `GeographicZonesManagement` consumer (Commit 6c). Both hooks share the
 * single `screensKeys.predefinedZones()` cache entry.
 */
export const useAdminZones = usePredefinedZones;

type CreateZoneInput = Parameters<typeof predefinedZonesService.create>[0];

interface UpdateZoneInput {
  id: string;
  patch: Parameters<typeof predefinedZonesService.update>[1];
}

interface ToggleZoneInput {
  id: string;
  isActive: boolean;
}

interface UploadZoneImageInput {
  zoneId: string;
  file: File;
}

/**
 * Zone write mutations.
 *
 * CF-14 invalidation graph: `screensKeys.predefinedZones()` — the admin
 * GeographicZones list, in this session. (The former `performancesKeys.all`
 * defensive invalidation targeted the Supabase-era OwnerPerformance dataset,
 * retired by Lane F — the rebuilt page reads engine endpoints under
 * `screenhostKeys` and embeds no zones read.)
 *
 * `uploadZoneImage` only uploads + returns a URL (the page folds it into form
 * state; the zone row is persisted by a subsequent `create`/`update`) — no
 * invalidation.
 */
export function useZoneMutations() {
  const queryClient = useQueryClient();

  const invalidateZones = () => {
    queryClient.invalidateQueries({ queryKey: screensKeys.predefinedZones() });
  };

  const createZone = useMutation({
    mutationFn: (zone: CreateZoneInput) => predefinedZonesService.create(zone),
    onSuccess: invalidateZones,
  });

  const updateZone = useMutation({
    mutationFn: ({ id, patch }: UpdateZoneInput) => predefinedZonesService.update(id, patch),
    onSuccess: invalidateZones,
  });

  const deleteZone = useMutation({
    mutationFn: (id: string) => predefinedZonesService.delete(id),
    onSuccess: invalidateZones,
  });

  const toggleZoneActive = useMutation({
    mutationFn: ({ id, isActive }: ToggleZoneInput) =>
      predefinedZonesService.toggleActive(id, isActive),
    onSuccess: invalidateZones,
  });

  const uploadZoneImage = useMutation({
    mutationFn: ({ zoneId, file }: UploadZoneImageInput) =>
      predefinedZonesService.uploadZoneImage(zoneId, file),
  });

  return { createZone, updateZone, deleteZone, toggleZoneActive, uploadZoneImage };
}
