import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';
import { useOwnerProfileMutations } from '@/features/auth/hooks/useOwnerProfileMutations';
import { useSectors } from '@/features/auth/hooks/useSectors';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerBankDetailsSlot from '@/features/profile/components/OwnerBankDetailsSlot';
import ProfileDocumentsManager, {
  type DocumentCategoryConfig,
} from '@/features/profile/components/ProfileDocumentsManager';
import ProfileSettings, {
  type ProfileFormInitialValues,
} from '@/features/profile/components/ProfileSettings';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';

/**
 * Screenhost profile/settings page (`/owner-settings`). Thin wrapper over the
 * shared `ProfileSettings` (slice-2 B4b) — supplies owner chrome
 * (OwnerNavigation + header + the loading/not-found early-returns) and owner
 * props; the bank sub-tab is the owner-only `OwnerBankDetailsSlot`.
 */
export default function OwnerSettings() {
  const navigate = useNavigate();
  const { user, profileType, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const isFleetOwner = profileType === 'fleet_owner';
  const isIndividualOwner = profileType === 'individual_owner';

  const { profile, loading } = useBusinessProfile(user?.id);
  const { data: sectors = [] } = useSectors();
  const { data: ownerSectors = [] } = useOwnerBusinessSectors();
  const { data: governorates = [] } = useGovernorates();
  const profileMutations = useOwnerProfileMutations(user?.id);

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  // Owner sector list + the legacy-fallback: if the saved sector isn't in the
  // owner set, append it so the dropdown can show it. The only reachable legacy
  // value is the saved one (the picker only offers ownerSectors), so deriving
  // from the saved id is equivalent to the former live-form derivation.
  const ownerSectorOptions = useMemo(() => {
    const selectedId = profile?.business_sector_id ?? '';
    if (!selectedId || ownerSectors.some((s) => s.id === selectedId)) return ownerSectors;
    const legacy = sectors.find((s) => s.id === selectedId);
    return legacy ? [...ownerSectors, legacy] : ownerSectors;
  }, [ownerSectors, sectors, profile?.business_sector_id]);

  const initialValues = useMemo<ProfileFormInitialValues | null>(() => {
    if (!profile) return null;
    const full = (profile.contact_name ?? '').trim();
    const space = full.indexOf(' ');
    const last_name = space <= 0 ? full : full.slice(0, space);
    const first_name = space <= 0 ? '' : full.slice(space + 1).trim();
    return {
      last_name,
      first_name,
      fonction: profile.fonction ?? '',
      contact_phone: profile.contact_phone ?? '',
      business_name: profile.business_name ?? '',
      tax_number: profile.tax_number ?? '',
      business_sector_id: profile.business_sector_id ?? '',
      company_size: profile.company_size ?? '',
      number_of_screens: profile.number_of_screens != null ? String(profile.number_of_screens) : '',
      number_of_rooms: profile.number_of_rooms != null ? String(profile.number_of_rooms) : '',
      street_address: profile.street_address ?? '',
      city: profile.city ?? '',
      postal_code: profile.postal_code ?? '',
      governorate_id: profile.governorate_id ?? '',
      zone: profile.zone ?? '',
      notify_news_updates: profile.notify_news_updates ?? false,
      notify_reminders_events: profile.notify_reminders_events ?? true,
      notify_promotions_offers: profile.notify_promotions_offers ?? false,
    };
  }, [profile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-brand-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex-1 p-8 text-center text-gray-600">Profil non trouvé</div>
      </div>
    );
  }

  // F-docs Commit 2 — the owner's identity/registry category by type (individual → CIN
  // recto/verso, fleet → RNE), plus the shared complémentaires group. Bank keeps its slot.
  const documentCategories: DocumentCategoryConfig[] = [
    isIndividualOwner
      ? { category: 'cin', title: "Carte d'identité nationale (CIN)" }
      : { category: 'rne', title: 'Registre de commerce (RNE)' },
    { category: 'complementaire', title: 'Documents complémentaires' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex min-h-screen">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 shrink-0">
            <h1 className="text-xl font-bold text-gray-900">Paramètres</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Gérez les informations de votre compte propriétaire
            </p>
          </header>
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <ProfileSettings
              variant="owner"
              loading={false}
              profileLoaded
              initialValues={initialValues}
              userEmail={user?.email}
              governorates={governorates}
              onSaveContact={(patch) =>
                profileMutations.updateContact.mutateAsync(patch).then(() => undefined)
              }
              onSaveBusiness={(patch) =>
                profileMutations.updateBusiness.mutateAsync(patch).then(() => undefined)
              }
              onSaveAddress={(patch) =>
                profileMutations.updateAddress.mutateAsync(patch).then(() => undefined)
              }
              onSaveNotifications={(patch) =>
                profileMutations.updateNotifications.mutateAsync(patch).then(() => undefined)
              }
              onChangePassword={(currentPassword, newPassword) =>
                profileMutations.updatePasswordWithOld
                  .mutateAsync({ currentPassword, newPassword })
                  .then(() => undefined)
              }
              sector={{ options: ownerSectorOptions, required: true, label: 'Catégorie' }}
              documentsSlot={
                <ProfileDocumentsManager
                  categories={documentCategories}
                  onChanged={() => void profileMutations.invalidateProfile()}
                />
              }
              fields={{
                companySize: isFleetOwner,
                numberOfScreens: true,
                numberOfRooms: true,
                zone: true,
              }}
              copy={{
                remindersText: 'Recevez des rappels pour diffuser vos campagnes et vos événements.',
                addressLabel: 'Adresse du siège',
              }}
              bankSlot={<OwnerBankDetailsSlot profile={profile} userId={user?.id ?? ''} />}
              bankSubLabel="Mes coordonnées bancaires"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
