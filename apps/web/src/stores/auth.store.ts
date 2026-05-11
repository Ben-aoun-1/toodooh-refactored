import { User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '../lib/supabase';
import { authService } from '../services/auth.service';

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  profileType: string | null;
  shouldOnboard?: boolean;
  needsApproval?: boolean;
  validationStatus?: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  refreshUserStatus: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => {
  // Fallback sur erreur/timeout: on essaie d'abord de CONSERVER l'état connu
  // (store + cache). On ne rétrograde en "pending" que si aucun état approuvé
  // n'a jamais été observé pour cet utilisateur. Objectif: ne pas déclasser
  // un utilisateur déjà validé à cause d'une erreur réseau transitoire.
  const getPreservedStateOnError = (cachedProfileType?: string | null) => {
    const storeState = useAuthStore.getState();
    const cachedValidationStatus = localStorage.getItem('user_validation_status');
    const cachedProfileTypeLs = localStorage.getItem('user_profile_type');

    const knownValidationStatus =
      storeState.validationStatus || cachedValidationStatus || undefined;
    const knownProfileType =
      storeState.profileType || cachedProfileType || cachedProfileTypeLs || null;
    const wasApproved =
      knownValidationStatus === 'approved' || knownValidationStatus === 'verified';

    if (wasApproved && knownProfileType) {
      console.warn("⚠️ Erreur/timeout fetchProfileType — conservation de l'état approuvé connu");
      return {
        profileType: knownProfileType,
        onboardingCompleted: true,
        needsApproval: false,
        validationStatus: knownValidationStatus,
      };
    }

    console.warn(
      '⚠️ Erreur/timeout fetchProfileType — aucun état approuvé connu, fallback pending',
    );
    return {
      profileType: knownProfileType,
      onboardingCompleted: false,
      needsApproval: true,
      validationStatus: 'pending',
    };
  };

  // Helper pour charger le profile_type
  const fetchProfileType = async (userId: string, forceRefresh = false) => {
    try {
      console.log('🔄 fetchProfileType called for user:', userId, 'forceRefresh:', forceRefresh);

      // Vérifier si c'est un admin (vérifier dans admin-storage)
      const adminStorage = localStorage.getItem('admin-storage');
      if (adminStorage) {
        try {
          const adminData = JSON.parse(adminStorage);
          if (adminData?.state?.admin?.id) {
            console.log('✅ Admin détecté, skip fetchProfileType');
            return {
              profileType: null,
              onboardingCompleted: true,
              needsApproval: false,
              validationStatus: 'approved',
            };
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      // Vérifier le cache localStorage d'abord
      const onboardingCompleted = localStorage.getItem('onboardingCompleted') === 'true';
      const cachedProfileType = localStorage.getItem('user_profile_type');
      const cachedValidationStatus = localStorage.getItem('user_validation_status');
      const isCachedApproved =
        cachedValidationStatus === 'approved' || cachedValidationStatus === 'verified';

      // Porte du cache assouplie: si l'utilisateur est approuvé/verified,
      // on peut utiliser le cache même si l'onboarding n'est pas marqué terminé.
      // La validation admin et l'onboarding sont deux choses distinctes.
      if (!forceRefresh && cachedProfileType && isCachedApproved) {
        console.log('✅ Utilisation du cache (compte approuvé/verified)');
        return {
          profileType: cachedProfileType,
          onboardingCompleted: true,
          needsApproval: false,
          validationStatus: cachedValidationStatus,
        };
      }

      // Porte historique: onboarding terminé + cache complet → utilisation du cache
      if (!forceRefresh && onboardingCompleted && cachedProfileType && cachedValidationStatus) {
        console.log('✅ Utilisation du cache pour éviter la requête');
        return {
          profileType: cachedProfileType,
          onboardingCompleted: true,
          needsApproval:
            cachedValidationStatus !== 'approved' && cachedValidationStatus !== 'verified',
          validationStatus: cachedValidationStatus,
        };
      }

      // Sinon, récupérer depuis business_profiles
      try {
        console.log('📊 Fetching from business_profiles for user:', userId);

        // Timeout plus tolérant (30s) car en arrière-plan les navigateurs throttlent les timers/fetchs.
        // Si l'onglet est inactif, une requête peut légitimement dépasser 10s. Mieux vaut attendre
        // une vraie réponse que de rétrograder l'utilisateur par erreur.
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Timeout: requête Supabase trop longue')),
            30000,
          );
        });

        const queryPromise = supabase
          .from('business_profiles')
          .select(
            'profile_type, business_name, verification_status, contact_name, onboarding_completed, is_active',
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let result: any;
        try {
          result = await Promise.race([
            queryPromise.then((r) => {
              clearTimeout(timeoutId);
              return r;
            }),
            timeoutPromise,
          ]);
        } catch (timeoutError: any) {
          clearTimeout(timeoutId);
          if (timeoutError?.message?.includes('Timeout')) {
            console.error(
              "⏱️ Timeout lors de la requête business_profiles — conservation de l'état connu",
            );
            return getPreservedStateOnError(cachedProfileType);
          }
          throw timeoutError;
        }

        const { data, error } = result;

        if (error) {
          console.error('❌ Error fetching user info:', error);
          if (error.code === 'PGRST116') {
            console.log('⚠️ Table business_profiles not found');
          }
          // Erreur transitoire/réseau/RLS: on conserve l'état connu si possible
          return getPreservedStateOnError(cachedProfileType);
        }

        // Pas de données = pas de profil en base. Ici on ne doit PAS préserver un ancien
        // état "approved": c'est un état avéré par la DB, donc on retourne bien pending.
        if (!data) {
          console.log('⚠️ No business profile found for user');
          return {
            profileType: cachedProfileType || null,
            onboardingCompleted: false,
            needsApproval: true,
            validationStatus: 'pending',
          };
        }

        if (data.is_active === false) {
          console.log('⚠️ Compte désactivé, déconnexion');
          await authService.logout();
          return {
            profileType: cachedProfileType || null,
            onboardingCompleted: false,
            needsApproval: true,
            validationStatus: 'pending',
          };
        }

        // IMPORTANT: Logger les données récupérées pour débogage
        console.log('✅ Données utilisateur récupérées:', {
          profile_type: data.profile_type,
          business_name: data.business_name,
          verification_status: data.verification_status,
        });

        // Permettre la connexion même si pending, mais marquer needsApproval
        // Vérifier uniquement verification_status (status n'existe pas dans business_profiles)
        const isPending =
          data.verification_status !== 'verified' && data.verification_status !== 'approved';

        if (isPending) {
          console.log('⚠️ Utilisateur en attente de validation');
          console.log('   - verification_status:', data.verification_status);
          console.log('   → needsApproval: TRUE');

          // Retourner le profileType mais indiquer qu'ils ont besoin d'approbation
          return {
            profileType: data.profile_type,
            onboardingCompleted: false,
            needsApproval: true,
            validationStatus: data.verification_status,
          };
        }

        // Utilisateur approuvé
        console.log('✅ Utilisateur validé et approuvé - Accès complet autorisé');

        const profileType = data?.profile_type || null;
        const contactName = data?.contact_name || null;
        const validationStatus = data?.verification_status || 'approved';

        // Mettre en cache les données pour éviter les requêtes futures
        if (profileType) {
          localStorage.setItem('user_profile_type', profileType);
          localStorage.setItem('user_raison_social', contactName || '');
          localStorage.setItem('user_validation_status', validationStatus);
          console.log('📝 Profile type stocké dans localStorage:', profileType);
          console.log('📝 Nom et prénom stockés dans localStorage:', contactName);
          console.log('📝 Validation status stocké dans localStorage:', validationStatus);
        }

        // Utiliser onboarding_completed de la DB si disponible, sinon utiliser le localStorage
        const dbOnboardingCompleted = data?.onboarding_completed ?? onboardingCompleted;
        if (dbOnboardingCompleted) {
          localStorage.setItem('onboardingCompleted', 'true');
        }

        // Utilisateur approuvé - accès complet
        return {
          profileType,
          onboardingCompleted: dbOnboardingCompleted,
          needsApproval: false,
          validationStatus: validationStatus,
        };
      } catch (dbError: any) {
        console.error('Database error in fetchProfileType:', dbError);
        if (dbError?.message?.includes('Timeout')) {
          console.error('⏱️ Timeout lors de la récupération du profil utilisateur');
        }
        // Erreur transitoire: on conserve l'état connu (approuvé/verified) s'il existe
        return getPreservedStateOnError(cachedProfileType);
      }
    } catch (error: any) {
      console.error('Error in fetchProfileType:', error);
      if (error?.message?.includes('Timeout')) {
        console.error('⏱️ Timeout lors de la récupération du profil utilisateur');
      }
      return getPreservedStateOnError(null);
    }
  };

  // Initialize auth state
  let authListenerInitialized = false;
  let lastProcessedEvent: { event: string; userId: string | null; timestamp: number } | null = null;
  let lastKnownUserId: string | null = null;
  const DEBOUNCE_MS = 500; // Déduplication de 500ms

  const initializeAuthListener = () => {
    if (authListenerInitialized) return;

    // Ne pas s'initialiser si on est sur une route admin
    if (window.location.pathname.startsWith('/admin')) {
      console.log('On admin route, skipping auth listener initialization');
      set({
        user: null,
        profileType: null,
        initialized: true,
        loading: false,
        needsApproval: false,
        validationStatus: undefined,
      });
      return;
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      const userId = session?.user?.id || null;
      const now = Date.now();

      // Déduplication : ignorer les événements identiques dans un court laps de temps
      if (
        lastProcessedEvent &&
        lastProcessedEvent.event === event &&
        lastProcessedEvent.userId === userId &&
        now - lastProcessedEvent.timestamp < DEBOUNCE_MS
      ) {
        console.log('⏭️ Événement auth dédupliqué, ignoré:', event, userId);
        return;
      }

      lastProcessedEvent = { event, userId, timestamp: now };
      console.log('Auth state change:', event, userId);

      const user = session?.user || null;

      // TOKEN_REFRESHED / USER_UPDATED: ce ne sont pas de vrais changements d'auth.
      // On ne recharge PAS le profil (sinon risque de rétrograder l'utilisateur
      // sur erreur/timeout réseau). On met simplement à jour la référence user.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        console.log('⏭️ Événement sans impact sur needsApproval, skip fetchProfileType:', event);
        if (user) {
          set({ user });
        }
        lastKnownUserId = userId;
        return;
      }

      // Si l'userId n'a pas changé pour un événement non-SIGN_IN/OUT, inutile de refetch
      if (
        userId === lastKnownUserId &&
        event !== 'SIGNED_IN' &&
        event !== 'SIGNED_OUT' &&
        event !== 'INITIAL_SESSION'
      ) {
        console.log('⏭️ userId inchangé, skip fetchProfileType pour événement:', event);
        if (user) {
          set({ user });
        }
        return;
      }

      lastKnownUserId = userId;

      let profileType = null;
      let shouldOnboard = false;
      let needsApproval = false;
      let validationStatus = undefined;

      if (user) {
        try {
          console.log('🔄 Auth listener: Fetching profile type for user:', user.id);
          const result = await fetchProfileType(user.id);
          console.log('✅ Auth listener: fetchProfileType returned:', result);

          profileType = result.profileType;
          shouldOnboard = !result.onboardingCompleted;
          needsApproval = result.needsApproval || false;
          validationStatus = result.validationStatus;

          console.log('✅ Auth listener: Variables assigned:', {
            profileType,
            shouldOnboard,
            needsApproval,
            validationStatus,
          });
        } catch (error) {
          console.error('❌ Auth listener error:', error);
          // En cas d'erreur inattendue, conserver l'état actuel du store plutôt
          // que de rétrograder l'utilisateur.
          const current = useAuthStore.getState();
          profileType = current.profileType;
          shouldOnboard = current.shouldOnboard || false;
          needsApproval = current.needsApproval || false;
          validationStatus = current.validationStatus;
        }
      }

      console.log('✅ Auth listener: About to set state:', {
        user: !!user,
        profileType,
        shouldOnboard,
        needsApproval,
        validationStatus,
      });
      set({
        user,
        profileType,
        shouldOnboard: shouldOnboard || false,
        needsApproval: needsApproval || false,
        validationStatus,
      });
      console.log('✅ Auth listener: State set successfully!');
    });

    authListenerInitialized = true;
  };

  return {
    user: null,
    loading: false,
    initialized: false,
    profileType: null,
    shouldOnboard: false,

    initialize: async () => {
      try {
        set({ loading: true });

        // Initialiser le listener d'auth seulement une fois
        initializeAuthListener();

        const user = await authService.getCurrentUser();
        let profileType = null;
        let shouldOnboard = false;
        let needsApproval = false;
        let validationStatus = undefined;

        if (user) {
          try {
            // Ajouter un timeout global pour éviter que l'initialisation bloque
            let initTimeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise((_, reject) => {
              initTimeoutId = setTimeout(() => reject(new Error('Timeout initialization')), 15000); // 15 secondes max
            });

            const profilePromise = fetchProfileType(user.id).then((result) => {
              clearTimeout(initTimeoutId);
              return result;
            });

            const result = (await Promise.race([profilePromise, timeoutPromise])) as any;
            clearTimeout(initTimeoutId);
            const {
              profileType: pt,
              onboardingCompleted,
              needsApproval: na,
              validationStatus: vs,
            } = result || {};
            profileType = pt;
            shouldOnboard = !onboardingCompleted;
            needsApproval = na || false;
            validationStatus = vs;
          } catch (profileError: any) {
            console.error('Error fetching profile type:', profileError);
            // Si timeout, continuer avec des valeurs par défaut
            if (profileError?.message?.includes('Timeout')) {
              console.warn(
                "⏱️ Timeout lors de l'initialisation, utilisation de valeurs par défaut",
              );
            }
            // Continuer sans profileType si il y a une erreur
          }
        }

        // Toujours initialiser, même en cas d'erreur
        set({
          user,
          initialized: true,
          profileType,
          shouldOnboard,
          needsApproval,
          validationStatus,
          loading: false,
        });
        console.log('✅ Auth initialized:', { hasUser: !!user, profileType, initialized: true });
      } catch (error) {
        console.error('Error initializing auth:', error);
        // Toujours initialiser pour éviter le blocage
        set({
          user: null,
          initialized: true,
          profileType: null,
          shouldOnboard: false,
          needsApproval: false,
          validationStatus: undefined,
          loading: false,
        });
      }
    },

    login: async (email: string, password: string) => {
      set({ loading: true });
      try {
        const { user } = await authService.login(email, password);
        let profileType = null;
        let shouldOnboard = false;

        let needsApproval = false;
        let validationStatus = undefined;

        if (user) {
          // D'abord vérifier le localStorage (mis à jour par authService.login)
          const storedProfileType = localStorage.getItem('user_profile_type');
          const onboardingCompleted = localStorage.getItem('onboardingCompleted') === 'true';

          console.log('🔍 Store login - localStorage check:', {
            storedProfileType,
            onboardingCompleted,
            userId: user.id,
          });

          // Toujours appeler fetchProfileType pour obtenir le statut à jour depuis la DB
          console.log('🔄 Appel de fetchProfileType pour obtenir le statut de validation...');
          const {
            profileType: pt,
            onboardingCompleted: oc,
            needsApproval: na,
            validationStatus: vs,
          } = await fetchProfileType(user.id);
          profileType = pt;
          shouldOnboard = !oc;
          needsApproval = na || false;
          validationStatus = vs;
          console.log('✅ Statut récupéré:', {
            profileType: pt,
            needsApproval: na,
            validationStatus: vs,
          });
        }

        console.log('🔍 Store mis à jour avec profileType:', profileType);
        set({ user, loading: false, profileType, shouldOnboard, needsApproval, validationStatus });
      } catch (error) {
        set({
          loading: false,
          profileType: null,
          shouldOnboard: false,
          needsApproval: false,
          validationStatus: undefined,
        });
        throw error;
      }
    },

    logout: async () => {
      set({ loading: true });
      try {
        await authService.logout();
        // Nettoyer le localStorage lors de la déconnexion
        localStorage.removeItem('onboardingCompleted');
        localStorage.removeItem('justOnboarded');
        localStorage.removeItem('user_profile_type');
        localStorage.removeItem('user_raison_social');
        localStorage.removeItem('user_validation_status');
        set({
          user: null,
          loading: false,
          profileType: null,
          shouldOnboard: false,
          needsApproval: false,
          validationStatus: undefined,
        });
      } catch (error) {
        set({ loading: false });
        throw error;
      }
    },

    refreshUserStatus: async () => {
      const { user } = useAuthStore.getState();
      if (!user) return;

      set({ loading: true });
      try {
        console.log('🔄 Refreshing user status...');

        // Nettoyer le cache localStorage
        localStorage.removeItem('user_profile_type');
        localStorage.removeItem('user_raison_social');
        localStorage.removeItem('user_validation_status');
        localStorage.removeItem('onboardingCompleted');

        // Forcer le refresh depuis la DB
        const { profileType, onboardingCompleted, needsApproval, validationStatus } =
          await fetchProfileType(user.id, true);

        set({
          profileType,
          shouldOnboard: !onboardingCompleted,
          needsApproval,
          validationStatus,
          loading: false,
        });

        console.log('✅ User status refreshed:', { profileType, needsApproval, validationStatus });
      } catch (error) {
        console.error('❌ Error refreshing user status:', error);
        set({ loading: false });
      }
    },
  };
});
