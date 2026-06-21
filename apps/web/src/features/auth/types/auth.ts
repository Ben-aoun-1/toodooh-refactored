export interface BusinessProfile {
  id: string;
  user_id: string;
  business_name: string;
  tax_number: string;
  business_sector_id: string;
  business_type: 'local' | 'national' | 'agency' | 'event_organizer';
  profile_type: 'advertiser' | 'agency' | 'individual_owner' | 'fleet_owner';
  contact_name: string;
  contact_phone: string;
  fonction?: string;
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  zone?: string;
  cin?: string;
  cin_doc_url?: string;
  formule?: string;
  agent_toodooh?: string;
  number_of_screens?: number;
  number_of_rooms?: number;
  company_size?: string;
  logo_url?: string;
  registration_doc_url?: string;
  registration_doc_path?: string;
  /**
   * Phase-1f F5 — document presence, a direct map of GET /api/me's `documents` booleans (the columns
   * hold a storage key, not a URL; the view presigns on demand via getProfileDocumentUrlByCategory). The
   * `*_doc_url`/`*_doc_path` fields stay undefined off the /api/me bridge (no stored URL).
   */
  documents?: { registration: boolean; cin: boolean; bank: boolean };
  bank_account_holder?: string;
  bank_rib?: string;
  bank_iban?: string;
  bank_doc_path?: string;
  bank_doc_url?: string;
  bank_details_updated_at?: string;
  notify_news_updates?: boolean;
  notify_reminders_events?: boolean;
  notify_promotions_offers?: boolean;
  verification_status: 'pending' | 'verified' | 'rejected';
  terms_accepted: boolean;
  terms_accepted_at?: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
  is_admin: boolean;
  is_active?: boolean;
}

/**
 * One user_documents row as the API serializes it (F-docs Commit 1 docView) — the wire
 * shape of GET /api/profile/documents (grouped), the POST upload response's `document`,
 * and the per-document presign routes. No storage key on the wire; views presign by id.
 */
export interface ProfileDocument {
  id: string;
  category: 'cin' | 'rne' | 'complementaire' | 'bank';
  position: number;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}

/** GET /api/profile/documents — every category present, empty arrays when none. */
export type GroupedProfileDocuments = Record<
  'cin' | 'rne' | 'complementaire' | 'bank',
  ProfileDocument[]
>;

export interface BusinessSector {
  id: string;
  name: string;
  display_order?: number | null;
}

export interface Governorate {
  id: string;
  name: string;
}

export interface SupportObjectiveOption {
  id: string;
  label: string;
  display_order: number;
}

/** Établissement / localité saisi à l'inscription (propriétaire de parc) */
export interface FleetEstablishmentInput {
  name: string;
  screen_count: number;
  room_count: number;
  street_address: string;
  city: string;
  zone: string;
  governorate_id: string;
  postal_code?: string;
  // Screenhost geo + WiFi capture (P3) — one screenhosts row per establishment. All optional
  // ("add later"); the service maps street_address → `address` on the wire to match the endpoint.
  latitude?: number;
  longitude?: number;
  wifi_ssid?: string;
  wifi_password?: string;
}

export interface SignUpData {
  email: string;
  password: string;
  business_name: string;
  tax_number?: string; // Facultatif pour les propriétaires individuels
  business_sector_id: string;
  business_type: BusinessProfile['business_type'];
  profile_type: BusinessProfile['profile_type'];
  contact_name: string;
  contact_phone: string;
  fonction?: string; // Fonction du responsable
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  zone?: string; // Zone géographique pour les propriétaires
  cin?: string; // CIN pour les propriétaires individuels
  formule?: string; // Formule choisie par le propriétaire (abonnement, revenue_share) - loyer retiré pour les nouvelles inscriptions
  agent_toodooh?: string; // Agent Toodooh - champ de saisie libre pour les propriétaires
  number_of_screens?: number; // Nombre d'écrans pour les propriétaires
  number_of_rooms?: number; // Nombre de salles (étape Etablissement)
  company_size?: string; // Nombre d'établissements du parc / taille entreprise
  registration_doc?: File; // Document (CIN ou RNE) - facultatif
  company_logo?: File; // Logo entreprise/établissement
  bank_doc?: File; // Relevé d'identité bancaire (propriétaires)
  terms_accepted: boolean;
  // Screenhost geo + WiFi capture (P3) — individual_owner's single location, built server-side from
  // these top-level fields + the street_address/city/zone/… already sent. All optional ("add later").
  latitude?: number;
  longitude?: number;
  wifi_ssid?: string;
  wifi_password?: string;
  /** Localités créées après inscription (propriétaire de parc) */
  fleet_establishments?: FleetEstablishmentInput[];
}

export interface SignUpResult {
  user: unknown;
  session: unknown;
  requiresEmailConfirmation?: boolean;
  message?: string;
}

/** The 201 body of POST /api/signup (Phase-1f F2). */
export interface SignupResponse {
  userId: string;
  email: string;
  verificationRequired: boolean;
  message: string;
}

/**
 * The `user` object returned by GET /api/me (Phase-1f F4 — the profile read source). The forms read
 * a `BusinessProfile`; `getBusinessProfile` maps this → that (notifications flattened, status mapped,
 * deferred fields — logo/doc-urls — absent: the backend has no such columns). Bank details landed
 * with the QA-fix lane (PATCH /api/profile/bank + the `bank` document type).
 */
export interface MeUser {
  id: string;
  email: string;
  email_verified: boolean;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  onboarding_completed: boolean;
  profile_type: string | null;
  contact_name: string | null;
  business_name: string | null;
  tax_number: string | null;
  contact_phone: string | null;
  fonction: string | null;
  business_sector_id: string | null;
  business_type: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  zone: string | null;
  bank_account_holder: string | null;
  bank_rib: string | null;
  bank_iban: string | null;
  documents: { registration: boolean; cin: boolean; bank: boolean };
  notifications: {
    news_updates: boolean | null;
    reminders_events: boolean | null;
    promotions_offers: boolean | null;
  };
}

/**
 * The session/identity user the backend returns on `POST /api/signin` and `GET /api/me`
 * (snake_case wire, Phase-1f keystone). The store derives its routing state from this
 * (`mapRouting`); `/api/me` returns a superset (the full profile) but the store consumes
 * only this routing subset. `status` is `users.status` (no `verified` — Phase-1f D5).
 */
export interface SessionUser {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  /** The admin's moderation note. For a `rejected` account this is the rejection reason (N3). */
  validation_notes: string | null;
  /** Deficient document areas on a rejection: 'legal' (RNE/CIN) and/or 'bank' (RIB) (N3 Scenario 1). */
  rejection_topics: string[] | null;
  onboarding_completed: boolean;
  business_type: string | null;
  profile_type: string | null;
  contact_name: string | null;
}
