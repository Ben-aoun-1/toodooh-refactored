import {
  SignUpData,
  BusinessProfile,
  BusinessSector,
  Governorate,
  GroupedProfileDocuments,
  ProfileDocument,
  SignupResponse,
  SupportObjectiveOption,
  SessionUser,
  MeUser,
} from '@/features/auth/types/auth';
import { apiClient, ApiError } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { apiErrorMessage } from './auth-errors';

const log = logger.child({ module: 'auth.service' });

export const authService = {
  /**
   * The cookie-authenticated self-view (Phase-1f keystone). `GET /api/me` carries the routing
   * fields the store derives identity from. A 401 is the normal logged-out path → `null` (passes
   * `skipAuthRedirect` so it does NOT trip the mid-session 401 handler — D6). A non-401 failure
   * (network/5xx) is rethrown so the store can enter the retry state (D3) rather than silently log
   * the user out.
   */
  async getCurrentUser(): Promise<SessionUser | null> {
    try {
      const { user } = await apiClient.get<{ user: SessionUser }>('/me', {
        skipAuthRedirect: true,
      });
      return user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },

  async login(email: string, password: string): Promise<SessionUser> {
    try {
      // The signin response carries the full routing set (role/status/onboarding/profile_type);
      // the store populates from it directly — no extra /api/me on login (design §2.5).
      const { user } = await apiClient.post<{ user: SessionUser }>('/signin', { email, password });
      return user;
    } catch (error) {
      // 403 EMAIL_NOT_VERIFIED / 401 INVALID_CREDENTIALS → French toast via the existing form catch.
      throw new Error(apiErrorMessage(error));
    }
  },

  async signUp(data: SignUpData): Promise<SignupResponse> {
    // Accepted-fields JSON (snake wire, Phase-1f F2). F5 is REVERSED for owners (R7/N4): owner volet
    // files (registration_doc=RNE/bank_doc) ARE sent at signup via multipart (see
    // below). Still NOT sent: company_logo (no signup home) and the owner-extras
    // (cin/formule/number_of_screens/number_of_rooms/company_size — backend-stripped). Advertisers/
    // agencies stay JSON, no documents (F5 stands for them).
    // SENT (P3): screenhost geo + WiFi — top-level latitude/longitude/wifi_ssid/wifi_password build
    // the individual_owner's single location; `fleet_establishments` (one per fleet_owner location)
    // each carry the same, with street_address remapped to the endpoint's `address`. Empty optionals
    // are OMITTED — the endpoint's optionals validate-when-present (min(1)/uuid/^\d{4}$), so '' would
    // 400. profile_type is a non-privileged hint, mapped server-side (role input:false).
    const t = (v?: string) => (v && v.trim() ? v.trim() : undefined);
    const n = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    // One fleet establishment → one wire object. street_address → `address` (the endpoint's field);
    // optionals omitted-when-empty so a blank field never 400s on validate-when-present.
    const fleetEstablishments = data.fleet_establishments?.map((e) => ({
      name: e.name,
      screen_count: e.screen_count,
      ...(t(e.street_address) ? { address: t(e.street_address) } : {}),
      ...(t(e.city) ? { city: t(e.city) } : {}),
      ...(t(e.zone) ? { zone: t(e.zone) } : {}),
      ...(t(e.governorate_id) ? { governorate_id: t(e.governorate_id) } : {}),
      ...(t(e.postal_code) ? { postal_code: t(e.postal_code) } : {}),
      ...(n(e.latitude) !== undefined ? { latitude: n(e.latitude) } : {}),
      ...(n(e.longitude) !== undefined ? { longitude: n(e.longitude) } : {}),
      ...(t(e.wifi_ssid) ? { wifi_ssid: t(e.wifi_ssid) } : {}),
      ...(t(e.wifi_password) ? { wifi_password: t(e.wifi_password) } : {}),
      // H1 — per-establishment working hours (single window, ints 0–23; n() keeps a valid 0).
      ...(n(e.opening_hour) !== undefined ? { opening_hour: n(e.opening_hour) } : {}),
      ...(n(e.closing_hour) !== undefined ? { closing_hour: n(e.closing_hour) } : {}),
    }));
    const payload = {
      email: data.email,
      password: data.password,
      contact_name: data.contact_name,
      business_name: data.business_name,
      contact_phone: data.contact_phone,
      terms_accepted: data.terms_accepted,
      ...(t(data.tax_number) ? { tax_number: t(data.tax_number) } : {}),
      ...(data.profile_type ? { profile_type: data.profile_type } : {}),
      ...(t(data.business_type) ? { business_type: t(data.business_type) } : {}),
      ...(t(data.business_sector_id) ? { business_sector_id: t(data.business_sector_id) } : {}),
      ...(t(data.street_address) ? { street_address: t(data.street_address) } : {}),
      ...(t(data.city) ? { city: t(data.city) } : {}),
      ...(t(data.postal_code) ? { postal_code: t(data.postal_code) } : {}),
      ...(t(data.governorate_id) ? { governorate_id: t(data.governorate_id) } : {}),
      ...(t(data.fonction) ? { fonction: t(data.fonction) } : {}),
      ...(t(data.zone) ? { zone: t(data.zone) } : {}),
      ...(t(data.agent_toodooh) ? { agent_toodooh: t(data.agent_toodooh) } : {}),
      // Screenhost geo + WiFi (P3). Top-level = individual_owner's location; the array = fleet.
      ...(n(data.latitude) !== undefined ? { latitude: n(data.latitude) } : {}),
      ...(n(data.longitude) !== undefined ? { longitude: n(data.longitude) } : {}),
      ...(t(data.wifi_ssid) ? { wifi_ssid: t(data.wifi_ssid) } : {}),
      ...(t(data.wifi_password) ? { wifi_password: t(data.wifi_password) } : {}),
      // H1 — the individual_owner's working-hours window (skip = both absent → NULL columns).
      ...(n(data.opening_hour) !== undefined ? { opening_hour: n(data.opening_hour) } : {}),
      ...(n(data.closing_hour) !== undefined ? { closing_hour: n(data.closing_hour) } : {}),
      ...(fleetEstablishments?.length ? { fleet_establishments: fleetEstablishments } : {}),
    };
    // R7/N4 — owners now SEND their document volets (reversing F5 for owners): multipart with a
    // `payload` field = the accepted-fields JSON string + named file parts. SIGN-2 (ruling
    // 2026-08-31): an individual_owner sends NO legal volet (CIN is provide-later); fleet_owner
    // sends `rne`; both may send `bank`. Advertisers keep the JSON path verbatim (no documents at
    // signup). Files never enter `payload` (only scalar fields are spread).
    const isOwner = data.profile_type === 'individual_owner' || data.profile_type === 'fleet_owner';
    try {
      if (isOwner) {
        const form = new FormData();
        form.append('payload', JSON.stringify(payload));
        // Only the fleet owner carries a legal volet at signup.
        if (data.profile_type !== 'individual_owner' && data.registration_doc) {
          form.append('rne', data.registration_doc);
        }
        if (data.bank_doc) form.append('bank', data.bank_doc);
        return await apiClient.postForm<SignupResponse>('/signup', form);
      }
      return await apiClient.post<SignupResponse>('/signup', payload);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // QA-fix lane — the wizard's on-blur email pre-check (product ruling 2026-06-10 reversed
  // anti-enumeration for THIS surface; the endpoint is rate-limited, 10/min/IP). Returns
  // `null` when availability can't be determined (429/network) so callers fail OPEN — the
  // signup submit stays the server-side authority on duplicates.
  async checkEmailAvailability(email: string): Promise<boolean | null> {
    try {
      const { available } = await apiClient.post<{ available: boolean }>(
        '/signup/email-availability',
        { email },
      );
      return available;
    } catch {
      return null;
    }
  },

  // Kais QA3 — the wizard's step-2 matricule-fiscal pre-check, mirroring checkEmailAvailability.
  // Asks the rate-limited endpoint whether the tax number is already registered so a duplicate
  // surfaces BEFORE the last step (Kais: "contrôle avant la dernière étape") instead of only as a
  // transient toast at submit. `null` (429/network) fails OPEN — the signup submit's 409 stays the
  // server-side authority on the UNIQUE collision.
  async checkTaxAvailability(taxNumber: string): Promise<boolean | null> {
    try {
      const { available } = await apiClient.post<{ available: boolean }>(
        '/signup/tax-availability',
        { tax_number: taxNumber },
      );
      return available;
    } catch {
      return null;
    }
  },

  async logout() {
    try {
      await apiClient.post('/signout');
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // Slice-1 auth-bug-1 — the post-signup validation screen's "Renvoyer l'e-mail de vérification"
  // button. Hits better-auth's send-verification-email route DIRECTLY (not the /api client, which is
  // /api-scoped): going through the /auth/* handler keeps better-auth's built-in rate-limiter +
  // anti-enumeration (a custom /api wrapper would call auth.api.* and bypass both — origin-check is
  // router-level, and so is the rate-limiter). Anti-enum: the endpoint returns { status: true } for
  // an unknown OR already-verified email without sending, so the caller never branches on existence.
  // callbackURL mirrors signup's so the resent link lands on /verify-email (auto-login on first use).
  async resendVerificationEmail(email: string): Promise<void> {
    const res = await fetch('/auth/send-verification-email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: `${window.location.origin}/verify-email` }),
    });
    // Success is silent (status:true even when nothing was sent — anti-enum). A non-2xx is a 429
    // (rate-limited) or 5xx; surface a generic retry so the button doesn't dead-end.
    if (!res.ok) {
      throw new Error("Impossible d'envoyer l'e-mail pour le moment. Réessayez dans un instant.");
    }
  },

  // Phase-1f F6 — forgot-password request. Generic 200 (anti-enum, backend-built); the form keeps
  // its generic toast.
  async resetPassword(email: string): Promise<void> {
    try {
      await apiClient.post('/password/reset-request', { email });
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // Phase-1f F6 — the reset-landing's token path: better-auth's reset link redirects to
  // /update-password?token=, the form posts the token + the new password here. Distinct from the
  // with-old change (/change). (Replaces the old no-old `updatePassword` + its 6-char guard.)
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    try {
      await apiClient.post('/password/reset', { token, new_password: newPassword });
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  async updateBusinessProfile(updateData: Partial<BusinessProfile>) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Utilisateur non connecté');
    }

    const { data, error } = await supabase
      .from('business_profiles')
      .update(updateData)
      .eq('user_id', user.id)
      .select();

    if (error) {
      log.error({ error }, '❌ Erreur Supabase');
      log.error(
        { message: error.message, details: error.details, hint: error.hint, code: error.code },
        "Détails de l'erreur",
      );
      throw new Error(`Erreur lors de la mise à jour du profil: ${error.message}`);
    }

    return data;
  },

  // Phase-1f F6 — authenticated change: the backend re-auths the current password + revokes other
  // sessions, forwarding the refreshed cookie so the current device stays logged in (D4). No FE
  // bounce.
  async updatePasswordWithOld(currentPassword: string, newPassword: string): Promise<void> {
    try {
      await apiClient.post('/password/change', {
        current_password: currentPassword,
        new_password: newPassword,
      });
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // Phase-1f F4 — section-scoped profile saves (the forms already save per-section → 1:1 to the
  // PATCH endpoints). apiClient JSON.stringify DROPS `undefined` keys (so an empty uuid optional is
  // omitted → unchanged, not a null-400) and SENDS `null` (clears the nullable fonction/zone).
  // Owner-extras (number_of_screens/rooms/company_size) are accepted here and STRIPPED by the
  // backend (truthful, like signup).
  async updateProfileContact(patch: {
    contact_name?: string;
    contact_phone?: string;
    fonction?: string | null;
  }): Promise<void> {
    try {
      await apiClient.patch('/profile/contact', patch);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  async updateProfileBusiness(patch: {
    business_name?: string;
    tax_number?: string;
    business_sector_id?: string;
    business_type?: string;
    number_of_screens?: number | null;
    number_of_rooms?: number | null;
    company_size?: string | null;
  }): Promise<void> {
    try {
      await apiClient.patch('/profile/business', patch);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  async updateProfileAddress(patch: {
    street_address?: string;
    city?: string;
    postal_code?: string;
    governorate_id?: string;
    zone?: string | null;
  }): Promise<void> {
    try {
      await apiClient.patch('/profile/address', patch);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // QA-fix lane — the owner's bank coordinates (replaces the dead Supabase
  // business_profiles write). The bank document itself uploads separately via
  // uploadProfileDocument('bank', file); bank_details_updated_at is server-stamped.
  async updateProfileBank(patch: {
    bank_account_holder?: string;
    bank_rib?: string;
    bank_iban?: string;
  }): Promise<void> {
    try {
      await apiClient.patch('/profile/bank', patch);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  async updateProfileNotifications(patch: {
    notify_news_updates?: boolean;
    notify_reminders_events?: boolean;
    notify_promotions_offers?: boolean;
  }): Promise<void> {
    try {
      await apiClient.patch('/profile/notifications', patch);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // N3 Scenario 1 — a rejected account resubmits for review after correcting its documents. The
  // server returns it to a pristine 'pending' (rejected-only; 409 otherwise). Caller refreshes /api/me.
  async resubmitForReview(): Promise<void> {
    try {
      await apiClient.post('/profile/resubmit', {});
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // F-docs Commit 2 — the user's documents grouped by category (cin/rne/complementaire/bank),
  // the multi-document read source. Presence flags in /api/me stay the cheap booleans; this is
  // the full listing the settings manager renders.
  async listProfileDocuments(): Promise<GroupedProfileDocuments> {
    try {
      const { documents } = await apiClient.get<{ documents: GroupedProfileDocuments }>(
        '/profile/documents',
      );
      return documents;
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // Phase-1f F5, reshaped by F-docs Commit 2 — slot upload (multipart, post-signin; at signup
  // the user is unverified + logged-out and can't call this requireAuth endpoint). `position`
  // is REQUIRED for cin (1=recto, 2=verso — semantic slots); elsewhere it's omitted and the
  // server picks the lowest free slot (bank cap-1 → slot 1, re-upload replaces — the F1 flow).
  // Same-slot re-upload replaces in place. request.file() reads the first file (field name is
  // irrelevant).
  async uploadProfileDocument(
    category: 'rne' | 'cin' | 'complementaire' | 'bank',
    file: File,
    position?: number,
  ): Promise<ProfileDocument> {
    const form = new FormData();
    form.append('file', file);
    const query = position !== undefined ? `?position=${position}` : '';
    try {
      const { document } = await apiClient.postForm<{ document: ProfileDocument }>(
        `/profile/documents/${category}${query}`,
        form,
      );
      return document;
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // F-docs Commit 2 — presign ONE document by id ON DEMAND (presigned URLs expire → fetched on
  // view, never stored). Owner-scoped server-side; a foreign/missing id 404s → null.
  async getProfileDocumentUrlById(id: string): Promise<string | null> {
    try {
      const { url } = await apiClient.get<{ url: string }>(`/profile/documents/${id}/url`);
      return url;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw new Error(apiErrorMessage(error));
    }
  },

  // F-docs Commit 2 — category convenience for single-slot views (the bank RIB card): list,
  // then presign the lowest-position document. None of that category → null.
  async getProfileDocumentUrlByCategory(
    category: 'rne' | 'cin' | 'complementaire' | 'bank',
  ): Promise<string | null> {
    const documents = await this.listProfileDocuments();
    const lowest = [...documents[category]].sort((a, b) => a.position - b.position)[0];
    if (!lowest) return null;
    return this.getProfileDocumentUrlById(lowest.id);
  },

  // F-docs Commit 2 — owner-scoped delete. The server sweeps the MinIO object only when the
  // row owns its key (legacy backfilled objects are never deleted).
  async deleteProfileDocument(id: string): Promise<void> {
    try {
      await apiClient.del(`/profile/documents/${id}`);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // Phase-1f F4 — the profile READ now comes from GET /api/me (no GET /api/profile; the backend has
  // no logo/bank columns, so a dedicated endpoint couldn't supply them either). Map the /api/me user
  // → BusinessProfile: section fields direct, notifications FLATTENED (nested → flat notify_*),
  // status → verification_status; the deferred fields (logo_url/bank_*/doc-urls) are absent
  // (undefined) and render empty until their slice. 401 → null (logged out).
  async getBusinessProfile(): Promise<BusinessProfile | null> {
    let user: MeUser;
    try {
      ({ user } = await apiClient.get<{ user: MeUser }>('/me', { skipAuthRedirect: true }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw new Error(apiErrorMessage(error));
    }
    return {
      id: user.id,
      user_id: user.id,
      business_name: user.business_name ?? '',
      tax_number: user.tax_number ?? '',
      business_sector_id: user.business_sector_id ?? '',
      business_type: (user.business_type as BusinessProfile['business_type']) ?? 'local',
      profile_type: (user.profile_type as BusinessProfile['profile_type']) ?? 'advertiser',
      contact_name: user.contact_name ?? '',
      contact_phone: user.contact_phone ?? '',
      fonction: user.fonction ?? undefined,
      street_address: user.street_address ?? '',
      city: user.city ?? '',
      postal_code: user.postal_code ?? '',
      governorate_id: user.governorate_id ?? '',
      zone: user.zone ?? undefined,
      // Bank details (QA-fix lane). bank_doc_path carries the deterministic storage key when a
      // bank document exists — consumers (OwnerBankDetailsSlot/OwnerRevenue/OwnerDashboard) gate
      // on its truthiness; the view presigns on demand via getProfileDocumentUrlByCategory('bank').
      bank_account_holder: user.bank_account_holder ?? undefined,
      bank_rib: user.bank_rib ?? undefined,
      bank_iban: user.bank_iban ?? undefined,
      bank_doc_path: user.documents.bank ? `bank/${user.id}` : undefined,
      notify_news_updates: user.notifications.news_updates ?? false,
      notify_reminders_events: user.notifications.reminders_events ?? false,
      notify_promotions_offers: user.notifications.promotions_offers ?? false,
      verification_status: user.status === 'approved' ? 'verified' : user.status,
      terms_accepted: true,
      onboarding_completed: user.onboarding_completed,
      created_at: '',
      updated_at: '',
      is_admin: false,
      // F5 — document presence (direct map of /api/me's booleans). The *_doc_url fields stay
      // undefined (no stored URL; the view presigns on demand via getProfileDocumentUrlByCategory).
      documents: {
        registration: user.documents.registration,
        cin: user.documents.cin,
        bank: user.documents.bank,
      },
    };
  },

  // Phase-1f F1: reference reads repointed off Supabase onto the public GET endpoints
  // (Part-A Commit 3) via the keystone apiClient. The §5.3 audience collapse — advertiser vs owner
  // sectors are one endpoint with `?audience=`. Owner sectors no longer need the
  // `business_sector_id → id` remap: the endpoint already returns `{ id, name, ... }`.
  async getBusinessSectors(): Promise<BusinessSector[]> {
    try {
      return await apiClient.get<BusinessSector[]>('/business-sectors?audience=advertiser');
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  async getOwnerBusinessSectors(): Promise<BusinessSector[]> {
    try {
      return await apiClient.get<BusinessSector[]>('/business-sectors?audience=owner');
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  async getAppointmentObjectives(): Promise<SupportObjectiveOption[]> {
    // Compatibilité multi-environnements: certaines bases n'ont pas appointment_objectives.
    const preferredTables = [
      'support_objectives_owner',
      'support_objectives_advertiser_agency',
    ] as const;

    for (const table of preferredTables) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order('display_order', { ascending: true });

      if (!error) return data ?? [];
      if (error.code === 'PGRST205') continue;
      // Ne pas bloquer l'UI pour les objectifs; fallback local côté pages.
      return [];
    }

    return [];
  },

  async getGovernorates(): Promise<Governorate[]> {
    try {
      return await apiClient.get<Governorate[]>('/governorates');
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },
};
