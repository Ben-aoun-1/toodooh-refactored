import {
  SignUpData,
  BusinessProfile,
  BusinessSector,
  Governorate,
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

// Fonction pour mapper les erreurs techniques vers des messages fonctionnels
// TODO(phase-1): typed source [supabase] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapAuthError = (error: any): string => {
  const errorMessage =
    error?.message || error?.error_description || "Une erreur inattendue s'est produite";

  // Log de débogage pour identifier l'erreur complète

  // Erreurs d'inscription
  if (errorMessage.includes('User already registered')) {
    return '📧 Cette adresse email est déjà associée à un compte existant. Si c\'est votre compte, veuillez vous connecter. Si vous avez oublié votre mot de passe, utilisez la fonction "Mot de passe oublié".';
  }

  // NOTE: Email confirmation désactivée dans Supabase pour la phase de test
  // Les utilisateurs sont automatiquement connectés après inscription
  /*
  if (errorMessage.includes('Email not confirmed')) {
    return '✉️ Votre adresse email n\'est pas encore confirmée. Veuillez consulter votre boîte mail (vérifiez aussi les spams) et cliquer sur le lien de confirmation que nous vous avons envoyé.';
  }
  */

  if (errorMessage.includes('Invalid email')) {
    return "❌ L'adresse email saisie n'est pas valide. Veuillez vérifier le format (exemple: nom@entreprise.com) et réessayer.";
  }

  if (errorMessage.includes('Password should be at least')) {
    return '🔒 Le mot de passe doit contenir au moins 6 caractères. Pour votre sécurité, utilisez une combinaison de lettres majuscules, minuscules et chiffres.';
  }

  // Mise à jour du mot de passe : re-authentification requise par Supabase
  if (errorMessage.includes('reauthentication') || errorMessage.includes('re-authentication')) {
    return '🔒 Pour modifier votre mot de passe, vérifiez que le mot de passe actuel est correct et réessayez. Si le problème persiste, déconnectez-vous puis reconnectez-vous avant de changer le mot de passe.';
  }

  // Nouveau mot de passe identique à l'ancien
  if (
    errorMessage.includes('same as') ||
    errorMessage.includes('should be different') ||
    errorMessage.includes('different from')
  ) {
    return "🔒 Le nouveau mot de passe doit être différent de l'ancien.";
  }

  if (errorMessage.includes('Unable to validate email address')) {
    return "⚠️ Impossible de valider l'adresse email. Veuillez vérifier qu'elle est correctement écrite et qu'il s'agit d'une adresse email valide.";
  }

  // Erreurs de connexion
  if (errorMessage.includes('Invalid login credentials')) {
    return '🔐 Email ou mot de passe incorrect. Veuillez vérifier vos identifiants. Si vous avez oublié votre mot de passe, cliquez sur "Mot de passe oublié".';
  }

  // NOTE: Email confirmation désactivée dans Supabase pour la phase de test
  /*
  if (errorMessage.includes('Email not confirmed')) {
    return '✉️ Votre compte n\'est pas encore activé. Veuillez vérifier votre boîte mail (y compris les spams) et cliquer sur le lien de confirmation pour activer votre compte.';
  }
  */

  if (errorMessage.includes('Too many requests')) {
    return '⏱️ Trop de tentatives de connexion. Par sécurité, veuillez patienter quelques minutes avant de réessayer.';
  }

  if (errorMessage.includes('For security purposes, you can only request this after')) {
    return '🔒 Pour des raisons de sécurité, veuillez patienter quelques secondes avant de réessayer.';
  }

  // Erreurs de réinitialisation de mot de passe
  if (errorMessage.includes('Unable to send email')) {
    return "📧 Impossible d'envoyer l'email de réinitialisation du mot de passe. Veuillez vérifier votre connexion internet et réessayer dans quelques instants.";
  }

  // Erreurs de profil - Doublons
  if (errorMessage.includes('duplicate key value violates unique constraint')) {
    // Extraire la valeur en double si possible
    let duplicateValue = '';
    const keyMatch = errorMessage.match(/Key \(([^)]+)\)=\(([^)]+)\)/);
    if (keyMatch) {
      const field = keyMatch[1];
      const value = keyMatch[2];
      duplicateValue = ` (Valeur en double: ${value})`;

      // Messages spécifiques selon le champ
      if (field === 'tax_number') {
        return `🏢 Ce numéro de matricule fiscal (${value}) est déjà enregistré dans notre système. Si c'est votre entreprise, veuillez vous connecter avec votre compte existant. Pour toute assistance, contactez le support.`;
      }
      if (field === 'contact_phone') {
        return `📞 Ce numéro de téléphone (${value}) est déjà associé à un compte existant. Veuillez vous connecter ou utiliser un numéro différent.`;
      }
      if (field === 'email') {
        return `📧 Cette adresse email (${value}) est déjà associée à un compte existant. Veuillez vous connecter ou utiliser une adresse email différente. Si vous avez oublié votre mot de passe, cliquez sur "Mot de passe oublié".`;
      }
    }

    // Fallback si on ne peut pas extraire les détails
    if (errorMessage.includes('tax_number')) {
      return "🏢 Le numéro de matricule fiscal que vous avez saisi est déjà enregistré dans notre système. Si c'est votre entreprise, veuillez vous connecter avec votre compte existant.";
    }
    if (errorMessage.includes('contact_phone')) {
      return '📞 Le numéro de téléphone que vous avez saisi est déjà associé à un compte existant. Veuillez vous connecter ou utiliser un numéro différent.';
    }
    if (errorMessage.includes('email')) {
      return "📧 L'adresse email que vous avez saisie est déjà associée à un compte existant. Veuillez vous connecter ou utiliser une adresse email différente.";
    }

    // Message générique avec le plus de détails possible
    return `⚠️ Une information que vous avez saisie existe déjà dans notre système${duplicateValue}. Veuillez vérifier vos données ou vous connecter si vous avez déjà un compte.`;
  }

  if (errorMessage.includes('row-level security policy')) {
    return "🚫 Vous n'avez pas les permissions nécessaires pour effectuer cette action. Veuillez contacter l'administrateur si vous pensez que c'est une erreur.";
  }

  if (errorMessage.includes('foreign key constraint')) {
    // Identifier le champ spécifique qui pose problème
    if (errorMessage.includes('business_sector_id') || errorMessage.includes('business_sectors')) {
      return "🏢 Le secteur d'activité sélectionné n'est pas valide. Veuillez actualiser la page et choisir un secteur dans la liste déroulante.";
    }
    if (errorMessage.includes('governorate_id') || errorMessage.includes('governorates')) {
      return "📍 Le gouvernorat sélectionné n'est pas valide. Veuillez actualiser la page et choisir un gouvernorat dans la liste déroulante.";
    }
    if (errorMessage.includes('user_id')) {
      return '❌ Erreur technique lors de la création du compte. Veuillez réessayer. Si le problème persiste, contactez le support technique avec le code: ERR_USER_ID';
    }
    // Message générique si on ne peut pas identifier le champ
    return "⚠️ Une information sélectionnée n'est pas valide. Veuillez actualiser la page et vérifier que vous avez bien sélectionné un secteur d'activité et un gouvernorat dans les listes déroulantes.";
  }

  // Erreurs de réseau
  if (errorMessage.includes('fetch')) {
    return '🌐 Problème de connexion détecté. Veuillez vérifier votre connexion internet et réessayer.';
  }

  if (errorMessage.includes('timeout')) {
    return '⏱️ La demande a pris trop de temps à se terminer. Veuillez vérifier votre connexion et réessayer.';
  }

  // Erreurs génériques
  if (errorMessage.includes('JWT')) {
    return '🔓 Votre session a expiré pour des raisons de sécurité. Veuillez vous reconnecter pour continuer.';
  }

  if (errorMessage.includes('not found')) {
    return "🔍 La ressource demandée n'existe pas ou a été supprimée.";
  }

  // Pour les erreurs auth courtes et explicites (ex: validation mot de passe), les afficher telles quelles
  if (
    error?.code &&
    errorMessage.length < 200 &&
    (errorMessage.toLowerCase().includes('password') ||
      errorMessage.toLowerCase().includes('mot de passe'))
  ) {
    return errorMessage;
  }

  // Par défaut, retourner un message générique
  return "❌ Une erreur s'est produite. Veuillez réessayer dans quelques instants. Si le problème persiste, contactez notre support technique.";
};

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
    // Accepted-fields JSON (snake wire, Phase-1f F2). NOT sent: files (registration_doc/
    // company_logo/bank_doc — documents upload post-signin in F5, the endpoint is requireAuth),
    // owner-extras (cin/formule/number_of_screens/number_of_rooms/company_size) and
    // fleet_establishments (the endpoint strips unknowns; the owner slice has no endpoint). Empty
    // optionals are OMITTED — the endpoint's optionals validate-when-present (min(1)/uuid/^\d{4}$),
    // so '' would 400. profile_type is a non-privileged hint, mapped server-side (role input:false).
    const t = (v?: string) => (v && v.trim() ? v.trim() : undefined);
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
    };
    try {
      return await apiClient.post<SignupResponse>('/signup', payload);
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  async logout() {
    try {
      await apiClient.post('/signout');
    } catch (error) {
      throw new Error(apiErrorMessage(error));
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

  // Phase-1f F5 — document upload (multipart, post-signin). At signup the user is unverified +
  // logged-out and can't call this requireAuth endpoint, so the upload flow-position moved here.
  // type ∈ rne|cin (by role: advertiser→rne, individual_owner→cin, fleet_owner→rne). POST overwrites
  // (deterministic key) → re-upload replaces. request.file() reads the first file (field name is
  // irrelevant).
  async uploadProfileDocument(
    type: 'rne' | 'cin',
    file: File,
  ): Promise<{ type: string; key: string }> {
    const form = new FormData();
    form.append('file', file);
    try {
      return await apiClient.postForm<{ type: string; key: string }>(
        `/profile/documents/${type}`,
        form,
      );
    } catch (error) {
      throw new Error(apiErrorMessage(error));
    }
  },

  // Phase-1f F5 — presign the stored document ON DEMAND (presigned URLs expire → fetched on view,
  // never stored). 404 (no document of that type) → null.
  async getProfileDocumentUrl(type: 'rne' | 'cin'): Promise<string | null> {
    try {
      const { url } = await apiClient.get<{ url: string }>(`/profile/documents/${type}`);
      return url;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
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
      // undefined (no stored URL; the view presigns on demand via getProfileDocumentUrl).
      documents: { registration: user.documents.registration, cin: user.documents.cin },
    };
  },

  /** Met à jour le profil (responsable, entreprise, adresse, etc.). Seuls les champs fournis sont mis à jour. */
  /** Désactive le compte (équivalent « supprimer le compte »). Met is_active à false puis déconnecte. */
  async deactivateAccount(): Promise<void> {
    const userId = (await this.getCurrentUser())?.id;
    if (!userId) throw new Error('Non connecté');
    const { error } = await supabase
      .from('business_profiles')
      .update({ is_active: false })
      .eq('user_id', userId);
    if (error) throw new Error(error.message || 'Erreur lors de la désactivation');
    await this.logout();
  },

  async updateProfile(
    data: Partial<{
      contact_name: string;
      contact_phone: string;
      fonction: string | null;
      business_name: string;
      tax_number: string;
      business_sector_id: string | null;
      number_of_screens: number | null;
      number_of_rooms: number | null;
      company_size: string | null;
      logo_url: string | null;
      notify_news_updates: boolean | null;
      notify_reminders_events: boolean | null;
      notify_promotions_offers: boolean | null;
      street_address: string;
      city: string;
      postal_code: string;
      governorate_id: string | null;
      registration_doc_url: string | null;
      registration_doc_path: string | null;
    }>,
  ) {
    const userId = (await this.getCurrentUser())?.id;
    if (!userId) throw new Error('Non connecté');
    const payload: Record<string, unknown> = {};
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) payload[key] = value;
    });
    if (Object.keys(payload).length === 0) return;
    const { error } = await supabase
      .from('business_profiles')
      .update(payload)
      .eq('user_id', userId);
    if (error) throw new Error(error.message || mapAuthError(error));
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
