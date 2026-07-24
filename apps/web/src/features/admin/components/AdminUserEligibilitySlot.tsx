import ScreenhostEligibilityCard from '@/features/admin/components/ScreenhostEligibilityCard';
import { useScreenhostEligibility } from '@/features/admin/hooks/useAdminScreenhostEligibility';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';
import type { BusinessSector } from '@/features/auth/types/auth';
import type { ScreenhostWifi } from '@/features/screenhost/services/screenhost.service';

/** One venue's row — owns the per-venue eligibility GET so the card renders from a loaded view. */
function VenueEligibilityRow({
  screenhost,
  sectors,
}: {
  screenhost: ScreenhostWifi;
  sectors: BusinessSector[];
}) {
  const { data: view, isPending, isError } = useScreenhostEligibility(screenhost.id);

  if (isPending) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500">
        {screenhost.name} — chargement de l&apos;éligibilité...
      </div>
    );
  }
  if (isError || !view) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-red-600">
        {screenhost.name} — échec du chargement de l&apos;éligibilité.
      </div>
    );
  }
  return <ScreenhostEligibilityCard screenhost={screenhost} sectors={sectors} view={view} />;
}

/**
 * EL1 — admin « Éligibilité dispatch » section inside the UserManagement details modal: one
 * editor per the reviewed owner's screenhosts (the live venue rows), populating the per-venue
 * L-disp inputs through the toodooh admin API — NOT the legacy Supabase admin-screens surface.
 */
export default function AdminUserEligibilitySlot({
  screenhosts,
}: {
  screenhosts: ScreenhostWifi[];
}) {
  const { data: sectors = [] } = useOwnerBusinessSectors();

  if (screenhosts.length === 0) {
    return <p className="text-sm text-gray-500">Aucun lieu enregistré.</p>;
  }

  return (
    <div className="space-y-4">
      {screenhosts.map((sh) => (
        <VenueEligibilityRow key={sh.id} screenhost={sh} sectors={sectors} />
      ))}
    </div>
  );
}
