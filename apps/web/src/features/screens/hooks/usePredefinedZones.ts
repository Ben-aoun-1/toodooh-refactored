import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { performancesKeys } from '@/features/performances/hooks/queryKeys';
import {
  predefinedZonesService,
  type PredefinedZone,
} from '@/features/screens/services/predefined-zones.service';

import { screensKeys } from './queryKeys';

/**
 * Predefined geographic zones (admin view — includes inactive zones).
 * `predefined-zones.service` is screens-owned (D6); `GeographicZonesManagement`
 * (an admin page) is its first React Query consumer, so the hooks land here.
 */
export function useAdminZones(): {
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
 * CF-14 invalidation graph:
 * - (a) `screensKeys.predefinedZones()` — the admin GeographicZones list, in
 *   this session.
 * - (b) `performancesKeys.all` — `OwnerPerformance`'s dataset embeds a
 *   `predefined_zones` read. Cross-session (admin ≠ owner): a no-op here, kept
 *   for intent + defence. NewCampaign / the campaign wizard also read zones but
 *   have no React Query key yet — that is a Commit 7 prerequisite, not an entry
 *   that can be invalidated today.
 *
 * `uploadZoneImage` only uploads + returns a URL (the page folds it into form
 * state; the zone row is persisted by a subsequent `create`/`update`) — no
 * invalidation.
 */
export function useZoneMutations() {
  const queryClient = useQueryClient();

  const invalidateZones = () => {
    queryClient.invalidateQueries({ queryKey: screensKeys.predefinedZones() });
    queryClient.invalidateQueries({ queryKey: performancesKeys.all });
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
