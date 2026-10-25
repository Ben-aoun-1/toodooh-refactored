import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import AdminLayout from '@/features/admin/components/AdminLayout';
import AdminUserEligibilitySlot from '@/features/admin/components/AdminUserEligibilitySlot';
import AdminUserWifiSlot from '@/features/admin/components/AdminUserWifiSlot';
import AdminVenueDeclarationForm from '@/features/admin/components/AdminVenueDeclarationForm';
import HostCalendarSection from '@/features/admin/components/host/HostCalendarSection';
import { HostSection } from '@/features/admin/components/host/HostField';
import HostHistoryCard from '@/features/admin/components/host/HostHistoryCard';
import HostLocksNotice from '@/features/admin/components/host/HostLocksNotice';
import HostOwnerAccountCard from '@/features/admin/components/host/HostOwnerAccountCard';
import HostVenueInfoCard from '@/features/admin/components/host/HostVenueInfoCard';
import { useHostFiche } from '@/features/admin/hooks/useAdminHost';

/**
 * HOST-EDIT1 — « Fiche Host » (/admin-screens/:id, ruling Q1 A): every parameter of one venue,
 * editable from the administration. The sections reuse the existing admin editors (éligibilité,
 * Wi-Fi, écrans déclarés) and the owner calendar card; each saves on its own, and every admin save
 * joins the « Historique » at the bottom.
 */
export default function HostFiche() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError } = useHostFiche(id);

  const back = (
    <Link
      to="/admin-screens"
      className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Localités et écrans
    </Link>
  );

  if (isPending || isError || !data) {
    return (
      <AdminLayout title="Fiche Host">
        <div className="space-y-4">
          {back}
          <p className={isError ? 'text-sm text-red-600' : 'text-sm text-gray-500'}>
            {isError ? 'Impossible de charger cet établissement.' : 'Chargement…'}
          </p>
        </div>
      </AdminLayout>
    );
  }

  const { venue, owner } = data;
  // The shape the reused WiFi / eligibility editors take.
  const editorVenue = {
    id: venue.id,
    name: venue.name,
    wifi_ssid: venue.wifi_ssid,
    wifi_password_set: venue.wifi_password_set,
  };

  return (
    <AdminLayout title={venue.name} subtitle="Fiche Host — tous les paramètres de l'établissement">
      <div className="mx-auto max-w-5xl space-y-6">
        {back}
        <HostVenueInfoCard venue={venue} />

        <HostSection
          title="Horaires & éligibilité"
          description="Catégorie, classe, horaires d'ouverture et capacité de diffusion."
        >
          <HostLocksNotice screenhostId={venue.id} locked={venue.locked_fields} />
          <AdminUserEligibilitySlot screenhosts={[editorVenue]} />
        </HostSection>

        <HostCalendarSection venue={{ id: venue.id, name: venue.name }} />

        <HostSection title="Écrans déclarés" description="Nombre d'écrans et de salles déclarés.">
          <AdminVenueDeclarationForm
            location={{
              id: venue.id,
              declared_screens_count: venue.screen_count,
              room_count: venue.room_count,
            }}
          />
        </HostSection>

        <HostSection title="Wi-Fi" description="Le réseau sur lequel les écrans se connectent.">
          <AdminUserWifiSlot screenhosts={[editorVenue]} />
        </HostSection>

        {owner ? (
          <HostOwnerAccountCard screenhostId={venue.id} owner={owner} />
        ) : (
          <HostSection title="Compte du propriétaire">
            <p className="text-sm text-gray-500">Cet établissement n&apos;a pas de propriétaire.</p>
          </HostSection>
        )}

        <HostHistoryCard screenhostId={venue.id} />
      </div>
    </AdminLayout>
  );
}
