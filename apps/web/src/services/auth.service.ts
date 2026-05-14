import { getAppUrl } from '../lib/app-url';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import {
  SignUpData,
  BusinessProfile,
  BusinessSector,
  Governorate,
  SignUpResult,
  CompanySizeOption,
  SupportObjectiveOption,
} from '../types/auth';
import { isErrorWithCode } from '../lib/errors';

const log = logger.child({ module: 'auth.service' });

// Fonction pour mapper les erreurs techniques vers des messages fonctionnels
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

/** Crée les lignes `locations` pour un propriétaire de parc après inscription. */
async function insertFleetEstablishmentsAfterSignup(
  userId: string,
  data: SignUpData,
): Promise<void> {
  const est = data.fleet_establishments;
  if (!est?.length || data.profile_type !== 'fleet_owner') return;
  const rows = est.map((e) => ({
    owner_id: userId,
    name: e.name,
    address: e.street_address,
    city: e.city,
    zone: e.zone,
    governorate_id: e.governorate_id || null,
    screen_count: e.screen_count,
    room_count: e.room_count,
    postal_code: e.postal_code || null,
  }));
  const { error } = await supabase.from('locations').insert(rows);
  if (error) {
    log.error({ error }, '⚠️ Insertion localités (parc) après inscription');
  } else {
  }
}

export const authService = {
  async checkSignupConflicts(
    email: string,
    contactPhone: string,
  ): Promise<{ emailExists: boolean; phoneExists: boolean }> {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedPhone = (contactPhone || '').replace(/\s+/g, '').trim();

    const { data, error } = await supabase.rpc('check_signup_conflicts_secure', {
      p_email: normalizedEmail,
      p_contact_phone: normalizedPhone,
    });

    if (error) {
      throw new Error(error.message || 'Échec de vérification unicité email/téléphone');
    }

    const first = Array.isArray(data) ? data[0] : data;
    return {
      emailExists: Boolean(first?.email_exists),
      // Contrôle unicité téléphone désactivé volontairement.
      phoneExists: false,
    };
  },

  async ensureBusinessProfileExists(userId: string, email: string): Promise<void> {
    const { data: existing, error: existingError } = await supabase
      .from('business_profiles')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }
    if (existing) return;
    void email;
    throw new Error(
      'Profil business introuvable pour ce compte. Vérifiez que les champs obligatoires d’inscription sont bien fournis (type de profil, type business, nom entreprise, contact, adresse, conditions).',
    );
  },

  async getCurrentUser() {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) {
        // Ne pas logger les erreurs de session manquante (normal quand pas connecté)
        if (error.message !== 'Auth session missing!') {
          log.error({ error }, 'Error getting current user');
        }
        return null;
      }
      return user;
    } catch (error) {
      const _err = isErrorWithCode(error) ? error : null;
      // Ne pas logger les erreurs de session manquante
      if (_err?.message !== 'Auth session missing!') {
        log.error({ error }, 'Error in getCurrentUser');
      }
      return null;
    }
  },

  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(mapAuthError(error));
    // Le store (auth.store.ts) appelle fetchProfileType après login pour
    // charger le profil et alimenter l'état persisté — plus de fetch ni de
    // localStorage ici.
    return data;
  },

  async signUp(data: SignUpData): Promise<SignUpResult> {
    const normalizeSectorName = (name: string) =>
      (name || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');

    let resolvedBusinessSectorId = (data.business_sector_id || '').trim();
    const requestedProfileType = (data.profile_type || '').trim() as SignUpData['profile_type'];

    const missingFields: string[] = [];
    const fieldLabels: Record<string, string> = {
      profile_type: 'type de profil',
      business_type: 'type business',
      business_name: "nom de l'entreprise/établissement",
      contact_name: 'nom complet du responsable',
      contact_phone: 'téléphone',
      street_address: 'adresse',
      city: 'ville',
      postal_code: 'code postal',
      governorate_id: 'gouvernorat',
      terms_accepted: 'acceptation des conditions',
      agent_toodooh: 'code agent',
    };
    const pushMissing = (key: keyof typeof fieldLabels) => {
      missingFields.push(`${key} (${fieldLabels[key]})`);
    };

    if (!requestedProfileType) pushMissing('profile_type');
    if (!data.business_type) pushMissing('business_type');
    if (!String(data.business_name || '').trim()) pushMissing('business_name');
    if (!String(data.contact_name || '').trim()) pushMissing('contact_name');
    if (!String(data.contact_phone || '').trim()) pushMissing('contact_phone');
    if (!String(data.street_address || '').trim()) pushMissing('street_address');
    if (!String(data.city || '').trim()) pushMissing('city');
    if (!String(data.postal_code || '').trim()) pushMissing('postal_code');
    if (!data.governorate_id) pushMissing('governorate_id');
    if (!data.terms_accepted) pushMissing('terms_accepted');
    if (!String(data.agent_toodooh || '').trim()) pushMissing('agent_toodooh');
    if (missingFields.length > 0) {
      throw new Error(
        `Impossible de créer business_profiles: champs manquants -> ${missingFields.join(', ')}`,
      );
    }

    // Pré-vérification DB stricte AVANT création auth:
    // si le profile_type n'est pas accepté par l'enum/check DB, on bloque tout de suite.
    const { data: profileTypeCheckData, error: profileTypeCheckError } = await supabase.rpc(
      'validate_signup_profile_type',
      { p_profile_type: requestedProfileType },
    );
    if (profileTypeCheckError) {
      // Compatibilité ascendante: si la RPC n'existe pas encore,
      // ne pas bloquer l'inscription (sinon régression annonceur).
      if (profileTypeCheckError.code === 'PGRST202') {
        log.warn('⚠️ RPC validate_signup_profile_type absente; précheck ignoré temporairement.');
      } else {
        throw new Error(
          `Impossible de valider la configuration d'inscription (${profileTypeCheckError.code || 'UNKNOWN'}): ${profileTypeCheckError.message}`,
        );
      }
    } else {
      const profileTypeCheck = Array.isArray(profileTypeCheckData)
        ? profileTypeCheckData[0]
        : profileTypeCheckData;
      if (!profileTypeCheck?.is_valid) {
        throw new Error(
          profileTypeCheck?.error_message ||
            'Configuration base incompatible avec le type de profil demandé.',
        );
      }
    }

    // Agence: s'assurer qu'un secteur valide est toujours renseigné
    // pour éviter l'échec d'insert business_profiles.
    if (requestedProfileType === 'agency' && !resolvedBusinessSectorId) {
      const { data: sectorsRows, error: sectorsError } = await supabase
        .from('business_sectors')
        .select('id, name, display_order')
        .order('display_order', { ascending: true });

      if (sectorsError) {
        log.error({ sectorsError }, '❌ Impossible de charger business_sectors pour profil agence');
        throw new Error(
          'Configuration des secteurs indisponible. Réessayez dans quelques instants.',
        );
      }

      const sectors = sectorsRows || [];
      const target = sectors.find((s: any) => {
        const n = normalizeSectorName(String(s?.name || ''));
        return n === 'agence de publicite' || (n.includes('agence') && n.includes('publicit'));
      });

      // Fallback: premier secteur trié si le libellé attendu n'existe pas.
      resolvedBusinessSectorId = target?.id || sectors[0]?.id || '';
      if (!resolvedBusinessSectorId) {
        throw new Error('Aucun secteur disponible pour créer un compte agence.');
      }
    }

    // 1. VÉRIFIER SI L'EMAIL / TÉLÉPHONE EXISTENT DÉJÀ
    const normalizedEmail = (data.email || '').trim().toLowerCase();
    const normalizedPhone = (data.contact_phone || '').replace(/\s+/g, '').trim();

    const { emailExists } = await this.checkSignupConflicts(normalizedEmail, normalizedPhone);

    if (emailExists) {
      throw new Error(
        '📧 Cette adresse email est déjà associée à un compte existant. Veuillez vous connecter ou utiliser une autre adresse.',
      );
    }

    // Vérifier le matricule fiscal (seulement s'il est fourni)
    // Pour fleet_owner: ne pas bloquer en cas de doublon, on générera un matricule technique.
    let fleetOwnerTaxNumberConflict = false;
    if (data.tax_number && data.tax_number.trim() !== '') {
      const { data: existingTax } = await supabase
        .from('business_profiles')
        .select('user_id')
        .eq('tax_number', data.tax_number)
        .limit(1);

      if (existingTax && existingTax.length > 0) {
        if (requestedProfileType === 'fleet_owner') {
          fleetOwnerTaxNumberConflict = true;
          log.warn("⚠️ fleet_owner: tax_number déjà utilisé, génération d'un matricule technique.");
        } else {
          throw new Error(
            "🏢 Ce numéro de matricule fiscal est déjà enregistré dans notre système. Si c'est votre entreprise, veuillez vous connecter avec votre compte existant.",
          );
        }
      }
    }

    // 2. Créer l'utilisateur auth
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: getAppUrl('/login'),
      },
    });

    if (signUpError) {
      throw new Error(mapAuthError(signUpError));
    }

    if (!authData.user) {
      throw new Error('La création du compte a échoué. Veuillez réessayer.');
    }

    // Vérifier si l'utilisateur a déjà été créé (identité existante)
    if (authData.user.identities && authData.user.identities.length === 0) {
      throw new Error(
        '📧 Cette adresse email est déjà associée à un compte existant. Si c\'est votre compte, veuillez vous connecter. Si vous avez oublié votre mot de passe, utilisez la fonction "Mot de passe oublié".',
      );
    }

    // 3. Attendre un court instant pour que l'utilisateur soit synchronisé dans la base de données
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Attendre 1 seconde

    // 4. Créer le profil business
    // Générer un matricule temporaire si vide (pour propriétaires individuels)
    let taxNumber = data.tax_number;
    if (
      !taxNumber ||
      taxNumber.trim() === '' ||
      (requestedProfileType === 'fleet_owner' && fleetOwnerTaxNumberConflict)
    ) {
      // Générer un matricule temporaire unique basé sur l'ID utilisateur et timestamp
      taxNumber = `TEMP-${authData.user.id.substring(0, 8)}-${Date.now()}`;
    }

    const profileType = requestedProfileType;

    const signupData = {
      user_id: authData.user.id,
      email: normalizedEmail, // Ajout de l'email pour l'afficher dans l'admin
      business_name: data.business_name,
      tax_number: taxNumber,
      business_sector_id: resolvedBusinessSectorId || data.business_sector_id,
      business_type: data.business_type || (profileType === 'agency' ? 'agency' : 'local'),
      profile_type: profileType,
      contact_name: data.contact_name,
      contact_phone: normalizedPhone,
      fonction: data.fonction || null,
      street_address: data.street_address,
      city: data.city,
      postal_code: data.postal_code,
      governorate_id: data.governorate_id,
      zone: data.zone, // Zone géographique pour les propriétaires
      cin: data.cin, // CIN pour les propriétaires individuels
      formule: data.formule, // Formule choisie par le propriétaire
      agent_toodooh: data.agent_toodooh, // Agent Toodooh pour les propriétaires
      number_of_screens: data.number_of_screens, // Nombre d'écrans pour les propriétaires
      number_of_rooms: data.number_of_rooms, // Nombre de salles
      company_size: data.company_size || null, // Taille entreprise / parc
      terms_accepted: data.terms_accepted,
      terms_accepted_at: new Date().toISOString(),
      verification_status: 'pending', // En attente de validation admin
      onboarding_completed: false,
      is_admin: false,
    };

    // 5. Essayer de créer le profil avec plusieurs stratégies
    let profileCreated = false;
    let profileError = null;

    // Stratégie 1: Insertion directe
    const { error: directInsertError } = await supabase
      .from('business_profiles')
      .insert(signupData);

    // 6. IMPORTANT: Fonction pour uploader le document (définie AVANT pour être utilisée partout)
    const uploadDocument = async () => {
      if (data.registration_doc) {
        try {
          const ext = data.registration_doc.name.split('.').pop();

          // Déterminer le type de document et le nom du fichier
          const isIndividualOwner = data.profile_type === 'individual_owner';
          const filePrefix = isIndividualOwner ? 'cin' : 'rne';
          const filePath = `${filePrefix}_${authData.user.id}_${Date.now()}.${ext}`;

          // Upload vers le bucket registres
          const { error: uploadError } = await supabase.storage
            .from('registres')
            .upload(filePath, data.registration_doc);

          if (uploadError) {
            log.error({ uploadError }, '⚠️ Erreur upload document (non bloquante)');
            return;
          }

          // Créer une URL signée
          const { data: signedData, error: signedError } = await supabase.storage
            .from('registres')
            .createSignedUrl(filePath, 604800); // 7 jours

          if (signedError || !signedData) {
            log.error({ signedError }, '⚠️ Erreur création URL signée');
            return;
          }

          // Mettre à jour le profil avec l'URL du document
          const updateField = isIndividualOwner ? 'cin_doc_url' : 'registration_doc_url';

          const { error: updateError } = await supabase
            .from('business_profiles')
            .update({ [updateField]: signedData.signedUrl })
            .eq('user_id', authData.user.id);

          if (updateError) {
            log.error({ updateError }, '⚠️ Erreur sauvegarde URL (non bloquante)');
          } else {
          }
        } catch (fileError) {
          log.error({ fileError }, "⚠️ Erreur lors de l'upload du document (non bloquante)");
        }
      } else {
      }
    };

    // 7. Compléter les champs optionnels potentiellement absents après fallback RPC
    const enrichProfileOptionalFields = async () => {
      const patch: Record<string, any> = {
        fonction: data.fonction?.trim() || null,
        company_size: data.company_size || null,
        number_of_rooms: data.number_of_rooms ?? null,
      };

      const { error: updateError } = await supabase
        .from('business_profiles')
        .update(patch)
        .eq('user_id', authData.user.id);

      if (updateError) {
        log.error({ updateError }, '⚠️ Erreur mise à jour des champs optionnels');
      }
    };

    // 8. Upload logo entreprise/établissement puis sauvegarde logo_url
    const uploadCompanyLogo = async () => {
      if (!data.company_logo) return;

      try {
        const ext = data.company_logo.name.split('.').pop() || 'png';
        const filePath = `logo_${authData.user.id}_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('registres')
          .upload(filePath, data.company_logo);
        if (uploadError) {
          log.error({ uploadError }, '⚠️ Erreur upload logo (non bloquante)');
          return;
        }

        const { data: signedData, error: signedError } = await supabase.storage
          .from('registres')
          .createSignedUrl(filePath, 604800); // 7 jours
        if (signedError || !signedData) {
          log.error({ signedError }, '⚠️ Erreur URL logo signée (non bloquante)');
          return;
        }

        const { error: updateError } = await supabase
          .from('business_profiles')
          .update({ logo_url: signedData.signedUrl })
          .eq('user_id', authData.user.id);
        if (updateError) {
          log.error({ updateError }, '⚠️ Erreur sauvegarde logo_url (non bloquante)');
        }
      } catch (logoError) {
        log.error({ logoError }, '⚠️ Erreur inattendue upload logo (non bloquante)');
      }
    };

    // Vérifier le résultat de l'insertion
    if (!directInsertError) {
      profileCreated = true;
    } else {
      profileError = directInsertError;

      // Stratégie 2: Utiliser la fonction RPC create_business_profile avec
      // les bons noms de paramètres (p_*) si disponible.
      try {
        const { error: rpcError } = await supabase.rpc('create_business_profile', {
          p_user_id: authData.user.id,
          p_business_name: signupData.business_name,
          p_tax_number: signupData.tax_number,
          p_business_sector_id: signupData.business_sector_id,
          p_business_type: signupData.business_type,
          p_profile_type: signupData.profile_type,
          p_contact_name: signupData.contact_name,
          p_contact_phone: signupData.contact_phone,
          p_street_address: signupData.street_address,
          p_city: signupData.city,
          p_postal_code: signupData.postal_code,
          p_governorate_id: signupData.governorate_id,
          p_terms_accepted: signupData.terms_accepted,
          p_terms_accepted_at: signupData.terms_accepted_at,
          p_verification_status: signupData.verification_status,
          p_onboarding_completed: signupData.onboarding_completed,
          p_is_admin: signupData.is_admin,
        });
        if (!rpcError) {
          profileCreated = true;
        } else {
        }
      } catch (rpcError) {}
    }

    // Si aucune stratégie n'a fonctionné, bloquer l'inscription et exposer
    // l'erreur SQL pour identifier précisément le champ/problème manquant.
    if (!profileCreated) {
      log.error({ profileError }, '❌ Erreur critique lors de la création du profil');
      if (profileError) {
        log.error({ data: (profileError as any).code }, 'Code erreur');
        log.error({ message: profileError.message }, 'Message');
        log.error({ data: (profileError as any).details }, 'Details');
        log.error({ data: (profileError as any).hint }, 'Hint');
      }
      const pErr = profileError as any;
      if (
        pErr?.code === '22P02' &&
        String(pErr?.message || '')
          .toLowerCase()
          .includes('profile_type') &&
        String(pErr?.message || '')
          .toLowerCase()
          .includes('agency')
      ) {
        throw new Error(
          "Configuration base incomplète: l'enum public.profile_type ne contient pas 'agency'. Appliquez la migration 20260411152000_ensure_agency_profile_type_compat.sql puis réessayez.",
        );
      }
      throw new Error(
        `Echec création business_profiles (${pErr?.code || 'UNKNOWN'}): ${pErr?.message || 'Erreur inconnue'}${pErr?.details ? ` | details: ${pErr.details}` : ''}${pErr?.hint ? ` | hint: ${pErr.hint}` : ''}`,
      );
    }

    // Vérification finale anti-profil manquant
    await this.ensureBusinessProfileExists(authData.user.id, data.email);

    // Harmoniser les champs optionnels après la création du profil
    await enrichProfileOptionalFields();

    // Uploader le document avant de retourner
    await uploadDocument();
    await uploadCompanyLogo();

    await insertFleetEstablishmentsAfterSignup(authData.user.id, data);

    return authData;
  },

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(mapAuthError(error));
  },

  async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getAppUrl('/update-password'),
    });
    if (error) throw new Error(mapAuthError(error));
  },

  async updatePassword(password: string) {
    // Vérifier les critères de base
    if (password.length < 6) {
      throw new Error('Le mot de passe doit contenir au moins 6 caractères');
    }

    const { data, error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      log.error({ error }, '❌ Erreur lors de la mise à jour du mot de passe');
      if (isErrorWithCode(error)) {
        log.error(
          {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          },
          "Détails de l'erreur",
        );
      }
      throw new Error(mapAuthError(error));
    }

    return data;
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

  async updatePasswordWithOld(currentPassword: string, newPassword: string) {
    // First verify the current password
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Utilisateur non connecté');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });

    if (signInError) throw new Error('Le mot de passe actuel est incorrect');

    // Then update to the new password
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) {
      const mapped = mapAuthError(error);
      const generic =
        "❌ Une erreur s'est produite. Veuillez réessayer dans quelques instants. Si le problème persiste, contactez notre support technique.";
      throw new Error(mapped === generic ? error?.message || mapped : mapped);
    }
  },

  async getBusinessProfile(): Promise<BusinessProfile | null> {
    const user = await this.getCurrentUser();
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      // 1. Essayer de récupérer le profil normalement
      const { data: profile, error } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') return null;
        return null;
      }

      return profile;
    } catch (error) {
      throw error;
    }
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

  async getBusinessSectors(): Promise<BusinessSector[]> {
    const { data, error } = await supabase
      .from('business_sectors')
      .select('*')
      .order('display_order', { ascending: true, nullsFirst: false });
    if (error) throw new Error(mapAuthError(error));
    return data ?? [];
  },

  async getOwnerBusinessSectors(): Promise<BusinessSector[]> {
    const { data, error } = await supabase
      .from('owner_business_sectors')
      .select('business_sector_id, name, display_order')
      .order('display_order', { ascending: true });
    if (error) throw new Error(mapAuthError(error));
    return (data ?? []).map(
      (row: { business_sector_id: string; name: string; display_order: number | null }) => ({
        id: row.business_sector_id,
        name: row.name,
        display_order: row.display_order,
      }),
    );
  },

  async getCompanySizeOptions(): Promise<CompanySizeOption[]> {
    const { data, error } = await supabase
      .from('company_size_options')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) throw new Error(mapAuthError(error));
    return data ?? [];
  },

  async getSupportObjectivesForAdvertiserAgency(): Promise<SupportObjectiveOption[]> {
    const { data, error } = await supabase
      .from('support_objectives_advertiser_agency')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) throw new Error(mapAuthError(error));
    return data ?? [];
  },

  async getSupportObjectivesForOwners(): Promise<SupportObjectiveOption[]> {
    const { data, error } = await supabase
      .from('support_objectives_owner')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) throw new Error(mapAuthError(error));
    return data ?? [];
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
    const { data, error } = await supabase.from('governorates').select('*').order('name');

    if (error) throw new Error(mapAuthError(error));
    return data;
  },

  // Fonction utilitaire pour créer un profil par défaut
  async createDefaultProfile(userId: string, email: string) {
    void userId;
    void email;
    throw new Error(
      'Création de profil par défaut désactivée. Fournissez explicitement les champs requis de business_profiles: profile_type, business_type, business_name, contact_name, contact_phone, street_address, city, postal_code, governorate_id.',
    );
  },
};
