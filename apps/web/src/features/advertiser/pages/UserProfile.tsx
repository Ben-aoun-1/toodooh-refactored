import { useMemo } from 'react';

import {
  AGENCY_BUSINESS_SECTOR_NAME,
  sectorsForAdvertiserProfile,
} from '@/features/advertiser/constants/advertiserBusinessSectors';
import { useProfileMutations } from '@/features/advertiser/hooks/useProfileMutations';
import { useUserProfile } from '@/features/advertiser/hooks/useUserProfile';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useSectors } from '@/features/auth/hooks/useSectors';
import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import ProfileDocumentsManager from '@/features/profile/components/ProfileDocumentsManager';
import ProfileSettings, {
  type ProfileFormInitialValues,
} from '@/features/profile/components/ProfileSettings';

/**
 * Advertiser profile page (`/profile`). Thin wrapper over the shared
 * `ProfileSettings` (slice-2 B4a) — AdvertiserLayout supplies the chrome at the
 * route level. Wires the advertiser read/mutations/config; the owner consumer
 * lands in B4b.
 */
export default function UserProfile() {
  const user = useAuthStore((s) => s.user);
  const { profile, loading } = useUserProfile(user?.id);
  const { data: sectors = [] } = useSectors();
  const { data: governorates = [] } = useGovernorates();
  const { updateContact, updateBusiness, updateAddress, updateNotifications, invalidateProfile } =
    useProfileMutations(user?.id);

  const isAgencyProfile = profile?.profile_type === 'agency';

  const initialValues = useMemo<ProfileFormInitialValues | null>(() => {
    if (!profile) return null;
    const full = (profile.contact_name ?? '').trim();
    const space = full.indexOf(' ');
    const last_name = space <= 0 ? full : full.slice(0, space);
    const first_name = space <= 0 ? '' : full.slice(space + 1).trim();

    // Agency profiles render the sector read-only ("Agence de publicité"); the
    // saved value is the agency sector id (preserves the former agency-autoset
    // effect's outcome).
    let business_sector_id = profile.business_sector_id ?? '';
    if (isAgencyProfile && !business_sector_id) {
      const agencySector = sectors.find(
        (s) => s.name.trim().toLowerCase() === AGENCY_BUSINESS_SECTOR_NAME.toLowerCase(),
      );
      if (agencySector) business_sector_id = agencySector.id;
    }

    return {
      last_name,
      first_name,
      fonction: profile.fonction ?? '',
      contact_phone: profile.contact_phone ?? '',
      business_name: profile.business_name ?? '',
      tax_number: profile.tax_number ?? '',
      business_sector_id,
      // Advertiser company_size was never hydrated pre-B4a (the prior setState
      // omitted it in favour of dead screens/rooms keys) — preserved as ''.
      company_size: '',
      number_of_screens: '',
      number_of_rooms: '',
      street_address: profile.street_address ?? '',
      city: profile.city ?? '',
      postal_code: profile.postal_code ?? '',
      governorate_id: profile.governorate_id ?? '',
      zone: '',
      notify_news_updates: profile.notify_news_updates ?? false,
      notify_reminders_events: profile.notify_reminders_events ?? true,
      notify_promotions_offers: profile.notify_promotions_offers ?? false,
    };
  }, [profile, isAgencyProfile, sectors]);

  return (
    <ProfileSettings
      variant="advertiser"
      loading={loading}
      profileLoaded={Boolean(profile)}
      initialValues={initialValues}
      userEmail={user?.email}
      governorates={governorates}
      onSaveContact={(patch) => updateContact.mutateAsync(patch).then(() => undefined)}
      onSaveBusiness={(patch) => updateBusiness.mutateAsync(patch).then(() => undefined)}
      onSaveAddress={(patch) => updateAddress.mutateAsync(patch).then(() => undefined)}
      onSaveNotifications={(patch) => updateNotifications.mutateAsync(patch).then(() => undefined)}
      onChangePassword={(currentPassword, newPassword) =>
        authService.updatePasswordWithOld(currentPassword, newPassword).then(() => undefined)
      }
      sector={{
        options: sectorsForAdvertiserProfile(sectors, profile?.business_sector_id ?? ''),
        required: false,
        label: "Secteur d'activité",
        readOnlyValue: isAgencyProfile ? 'Agence de publicité' : undefined,
      }}
      documentsSlot={
        <ProfileDocumentsManager
          categories={[
            { category: 'rne', title: 'Registre de commerce (RNE)' },
            { category: 'complementaire', title: 'Documents complémentaires' },
          ]}
          onChanged={() => void invalidateProfile()}
        />
      }
      fields={{ companySize: 'company', numberOfScreens: false, numberOfRooms: false, zone: false }}
      copy={{
        remindersText: 'Recevez des rappels pour vos événements, échéances et rendez-vous à venir.',
        addressLabel: 'Adresse',
      }}
    />
  );
}
