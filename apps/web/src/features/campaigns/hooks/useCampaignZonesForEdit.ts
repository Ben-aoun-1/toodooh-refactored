import { useQuery } from '@tanstack/react-query';

import type { GeographicZone } from '@/features/campaigns/hooks/new-campaign/wizard-types';
import { campaignScreensService } from '@/features/campaigns/services/campaign-screens.service';
import { supabase } from '@/lib/supabase';

import { campaignsKeys } from './queryKeys';

/**
 * Edit-mode geographic-zone hydration for the campaign wizard (`NewCampaign`).
 *
 * Commit 7b — folded in from 7a's CF-10 §5.1. Reads the campaign's saved
 * `campaign_locations` links, hydrates them via `campaignScreensService`
 * (D4 — wraps the existing path), and rebuilds the single "restored selection"
 * zone the wizard seeds into `geographicZones`. Disabled outside edit mode;
 * the wizard seeds its client state from the result via a guarded derive
 * effect (CF-16). The composite read keeps its transform inside the queryFn
 * (same principle as the `campaign_categories` batch in `useMyCampaigns`).
 */
export function useCampaignZonesForEdit(campaignId: string | undefined): {
  zones: GeographicZone[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.zonesForEdit(campaignId ?? ''),
    queryFn: async (): Promise<GeographicZone[]> => {
      const { data: campaignLocs, error } = await supabase
        .from('campaign_locations')
        .select('location_id')
        .eq('campaign_id', campaignId as string);
      if (error || !campaignLocs?.length) return [];

      const locationIds = campaignLocs.map((row: { location_id: string }) => row.location_id);
      const locations = await campaignScreensService.getLocationsByIds(locationIds);
      if (locations.length === 0) return [];

      const withCoords = locations.filter(
        (loc) =>
          loc.coordinates &&
          typeof loc.coordinates.lat === 'number' &&
          typeof loc.coordinates.lng === 'number',
      );
      const latAvg = withCoords.length
        ? withCoords.reduce((sum, loc) => sum + loc.coordinates!.lat, 0) / withCoords.length
        : 36.8;
      const lngAvg = withCoords.length
        ? withCoords.reduce((sum, loc) => sum + loc.coordinates!.lng, 0) / withCoords.length
        : 10.2;
      const radiusM = withCoords.length
        ? Math.max(
            1000,
            ...withCoords.map((loc) => {
              const lat = loc.coordinates!.lat;
              const lng = loc.coordinates!.lng;
              const R = 6371000;
              const dLat = ((lat - latAvg) * Math.PI) / 180;
              const dLng = ((lng - lngAvg) * Math.PI) / 180;
              const a =
                Math.sin(dLat / 2) ** 2 +
                Math.cos((latAvg * Math.PI) / 180) *
                  Math.cos((lat * Math.PI) / 180) *
                  Math.sin(dLng / 2) ** 2;
              return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            }),
          )
        : 5000;

      return [
        {
          id: 'edit-restored',
          name: 'Sélection existante',
          location: { lat: latAvg, lng: lngAvg },
          radius: Math.round(radiusM),
          locations,
        },
      ];
    },
    enabled: Boolean(campaignId),
  });

  return {
    zones: query.data ?? [],
    loading: query.isLoading,
  };
}
