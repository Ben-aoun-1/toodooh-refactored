import type { BusinessProfile } from '../features/auth/types/auth';
import type { StatementRecipientDisplay } from '../types/ownerStatement';

/** Valeurs de démo (maquette) si profil incomplet */
const DEMO_RECIPIENT: StatementRecipientDisplay = {
  contactName: 'Ahmed Hamouda',
  companyName: 'Entreprise XYZ',
  addressLine1: '45 Rue de la Liberté',
  cityPostal: '1002 Tunis, Tunisie',
  email: 'ahmed@Hamouda.com',
};

export function buildStatementRecipient(
  profile: BusinessProfile | null,
  userEmail?: string | null,
): StatementRecipientDisplay {
  const email = userEmail?.trim() || DEMO_RECIPIENT.email;
  if (!profile) {
    return { ...DEMO_RECIPIENT, email };
  }
  const cityPostal = [profile.postal_code, profile.city].filter(Boolean).join(' ').trim();
  return {
    contactName: profile.contact_name?.trim() || DEMO_RECIPIENT.contactName,
    companyName: profile.business_name?.trim() || DEMO_RECIPIENT.companyName,
    addressLine1: profile.street_address?.trim() || DEMO_RECIPIENT.addressLine1,
    cityPostal: cityPostal ? `${cityPostal}, Tunisie` : DEMO_RECIPIENT.cityPostal,
    email,
  };
}
