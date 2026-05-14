import { User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { getErrorMessage } from '../lib/errors';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { authService } from '../services/auth.service';

import { useAdminStore } from './admin.store';

const log = logger.child({ module: 'auth.store' });

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  profileType: string | null;
  contactName: string | null;
  onboardingCompleted: boolean;
  shouldOnboard?: boolean;
  needsApproval?: boolean;
  validationStatus?: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  refreshUserStatus: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      // Fallback sur erreur/timeout: on essaie d'abord de CONSERVER l'état connu
      // (état persisté du store). On ne rétrograde en "pending" que si aucun état
      // approuvé n'a jamais été observé pour cet utilisateur. Objectif: ne pas
      // déclasser un utilisateur déjà validé à cause d'une erreur réseau transitoire.
      const getPreservedStateOnError = (cachedProfileType?: string | null) => {
        const storeState = useAuthStore.getState();

        const knownValidationStatus = storeState.validationStatus || undefined;
        const knownProfileType = storeState.profileType || cachedProfileType || null;
        const wasApproved =
          knownValidationStatus === 'approved' || knownValidationStatus === 'verified';

        if (wasApproved && knownProfileType) {
          log.warn("⚠️ Erreur/timeout fetchProfileType — conservation de l'état approuvé connu");
          return {
            profileType: knownProfileType,
            contactName: storeState.contactName ?? null,
            onboardingCompleted: true,
            needsApproval: false,
            validationStatus: knownValidationStatus,
          };
        }

        log.warn(
          '⚠️ Erreur/timeout fetchProfileType — aucun état approuvé connu, fallback pending',
        );
        return {
          profileType: knownProfileType,
          contactName: storeState.contactName ?? null,
          onboardingCompleted: false,
          needsApproval: true,
          validationStatus: 'pending',
        };
      };

      // Helper pour charger le profile_type
      const fetchProfileType = async (userId: string, forceRefresh = false) => {
        try {
          // Vérifier si c'est un admin (lire directement le store admin)
          if (useAdminStore.getState().admin?.id) {
            return {
              profileType: null,
              contactName: null,
              onboardingCompleted: true,
              needsApproval: false,
              validationStatus: 'approved',
            };
          }

          // Vérifier le cache (état persisté du store)
          const {
            profileType: cachedProfileType,
            validationStatus: cachedValidationStatus,
            contactName: cachedContactName,
            onboardingCompleted: cachedOnboardingCompleted,
          } = get();
          const isCachedApproved =
            cachedValidationStatus === 'approved' || cachedValidationStatus === 'verified';

          // Porte du cache assouplie: si l'utilisateur est approuvé/verified,
          // on peut utiliser le cache même si l'onboarding n'est pas marqué terminé.
          // La validation admin et l'onboarding sont deux choses distinctes.
          if (!forceRefresh && cachedProfileType && isCachedApproved) {
            return {
              profileType: cachedProfileType,
              contactName: cachedContactName,
              onboardingCompleted: true,
              needsApproval: false,
              validationStatus: cachedValidationStatus,
            };
          }

          // Porte historique: onboarding terminé + cache complet → utilisation du cache
          if (
            !forceRefresh &&
            cachedOnboardingCompleted &&
            cachedProfileType &&
            cachedValidationStatus
          ) {
            return {
              profileType: cachedProfileType,
              contactName: cachedContactName,
              onboardingCompleted: true,
              needsApproval:
                cachedValidationStatus !== 'approved' && cachedValidationStatus !== 'verified',
              validationStatus: cachedValidationStatus,
            };
          }

          // Sinon, récupérer depuis business_profiles
          try {
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

            // TODO(phase-1): typed source [supabase] — see #15
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let result: any;
            try {
              result = await Promise.race([
                queryPromise.then((r) => {
                  clearTimeout(timeoutId);
                  return r;
                }),
                timeoutPromise,
              ]);
            } catch (timeoutError) {
              clearTimeout(timeoutId);
              if (getErrorMessage(timeoutError)?.includes('Timeout')) {
                log.error(
                  "⏱️ Timeout lors de la requête business_profiles — conservation de l'état connu",
                );
                return getPreservedStateOnError(cachedProfileType);
              }
              throw timeoutError;
            }

            const { data, error } = result;

            if (error) {
              log.error({ error }, '❌ Error fetching user info');
              if (error.code === 'PGRST116') {
              }
              // Erreur transitoire/réseau/RLS: on conserve l'état connu si possible
              return getPreservedStateOnError(cachedProfileType);
            }

            // Pas de données = pas de profil en base. Ici on ne doit PAS préserver un ancien
            // état "approved": c'est un état avéré par la DB, donc on retourne bien pending.
            if (!data) {
              return {
                profileType: cachedProfileType || null,
                contactName: cachedContactName,
                onboardingCompleted: false,
                needsApproval: true,
                validationStatus: 'pending',
              };
            }

            if (data.is_active === false) {
              await authService.logout();
              return {
                profileType: cachedProfileType || null,
                contactName: null,
                onboardingCompleted: false,
                needsApproval: true,
                validationStatus: 'pending',
              };
            }

            // IMPORTANT: Logger les données récupérées pour débogage

            // Permettre la connexion même si pending, mais marquer needsApproval
            // Vérifier uniquement verification_status (status n'existe pas dans business_profiles)
            const isPending =
              data.verification_status !== 'verified' && data.verification_status !== 'approved';

            if (isPending) {
              // Retourner le profileType mais indiquer qu'ils ont besoin d'approbation
              return {
                profileType: data.profile_type,
                contactName: data.contact_name || cachedContactName || null,
                onboardingCompleted: false,
                needsApproval: true,
                validationStatus: data.verification_status,
              };
            }

            // Utilisateur approuvé

            const profileType = data?.profile_type || null;
            const contactName = data?.contact_name || null;
            const validationStatus = data?.verification_status || 'approved';
            // Utiliser onboarding_completed de la DB si disponible, sinon l'état persisté.
            const dbOnboardingCompleted = data?.onboarding_completed ?? cachedOnboardingCompleted;

            // Utilisateur approuvé - accès complet. Le caller fera set(...) et persist
            // se charge de la persistance (plus de localStorage manuel ici).
            return {
              profileType,
              contactName,
              onboardingCompleted: dbOnboardingCompleted,
              needsApproval: false,
              validationStatus,
            };
          } catch (dbError) {
            log.error({ dbError }, 'Database error in fetchProfileType');
            if (getErrorMessage(dbError)?.includes('Timeout')) {
              log.error('⏱️ Timeout lors de la récupération du profil utilisateur');
            }
            // Erreur transitoire: on conserve l'état connu (approuvé/verified) s'il existe
            return getPreservedStateOnError(cachedProfileType);
          }
        } catch (error) {
          log.error({ error }, 'Error in fetchProfileType');
          if (getErrorMessage(error)?.includes('Timeout')) {
            log.error('⏱️ Timeout lors de la récupération du profil utilisateur');
          }
          return getPreservedStateOnError(null);
        }
      };

      // Initialize auth state
      let authListenerInitialized = false;
      let authSubscription: { unsubscribe: () => void } | null = null;
      let lastProcessedEvent: { event: string; userId: string | null; timestamp: number } | null =
        null;
      let lastKnownUserId: string | null = null;
      const DEBOUNCE_MS = 500; // Déduplication de 500ms

      const initializeAuthListener = () => {
        if (authListenerInitialized || authSubscription) return;

        // Ne pas s'initialiser si on est sur une route admin
        if (window.location.pathname.startsWith('/admin')) {
          set({
            user: null,
            profileType: null,
            contactName: null,
            onboardingCompleted: false,
            initialized: true,
            loading: false,
            needsApproval: false,
            validationStatus: undefined,
          });
          return;
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, session) => {
          const userId = session?.user?.id || null;
          const now = Date.now();

          // Déduplication : ignorer les événements identiques dans un court laps de temps
          if (
            lastProcessedEvent &&
            lastProcessedEvent.event === event &&
            lastProcessedEvent.userId === userId &&
            now - lastProcessedEvent.timestamp < DEBOUNCE_MS
          ) {
            return;
          }

          lastProcessedEvent = { event, userId, timestamp: now };

          const user = session?.user || null;

          // TOKEN_REFRESHED / USER_UPDATED: ce ne sont pas de vrais changements d'auth.
          // On ne recharge PAS le profil (sinon risque de rétrograder l'utilisateur
          // sur erreur/timeout réseau). On met simplement à jour la référence user.
          if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
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
            if (user) {
              set({ user });
            }
            return;
          }

          lastKnownUserId = userId;

          let profileType: string | null = null;
          let contactName: string | null = null;
          let onboardingCompleted = false;
          let shouldOnboard = false;
          let needsApproval = false;
          let validationStatus = undefined;

          if (user) {
            try {
              const result = await fetchProfileType(user.id);

              profileType = result.profileType;
              contactName = result.contactName ?? null;
              onboardingCompleted = result.onboardingCompleted ?? false;
              shouldOnboard = !result.onboardingCompleted;
              needsApproval = result.needsApproval || false;
              validationStatus = result.validationStatus;
            } catch (error) {
              log.error({ error }, '❌ Auth listener error');
              // En cas d'erreur inattendue, conserver l'état actuel du store plutôt
              // que de rétrograder l'utilisateur.
              const current = useAuthStore.getState();
              profileType = current.profileType;
              contactName = current.contactName;
              onboardingCompleted = current.onboardingCompleted;
              shouldOnboard = current.shouldOnboard || false;
              needsApproval = current.needsApproval || false;
              validationStatus = current.validationStatus;
            }
          }

          set({
            user,
            profileType,
            contactName,
            onboardingCompleted,
            shouldOnboard: shouldOnboard || false,
            needsApproval: needsApproval || false,
            validationStatus,
          });
        });

        authSubscription = subscription;
        authListenerInitialized = true;
      };

      return {
        user: null,
        loading: false,
        initialized: false,
        profileType: null,
        contactName: null,
        onboardingCompleted: false,
        shouldOnboard: false,

        initialize: async () => {
          try {
            set({ loading: true });

            // Initialiser le listener d'auth seulement une fois
            initializeAuthListener();

            const user = await authService.getCurrentUser();
            let profileType: string | null = null;
            let contactName: string | null = null;
            let onboardingCompleted = false;
            let shouldOnboard = false;
            let needsApproval = false;
            let validationStatus = undefined;

            if (user) {
              try {
                // Ajouter un timeout global pour éviter que l'initialisation bloque
                let initTimeoutId: NodeJS.Timeout;
                const timeoutPromise = new Promise((_, reject) => {
                  initTimeoutId = setTimeout(
                    () => reject(new Error('Timeout initialization')),
                    15000,
                  ); // 15 secondes max
                });

                const profilePromise = fetchProfileType(user.id).then((result) => {
                  clearTimeout(initTimeoutId);
                  return result;
                });

                // TODO(phase-1): typed source [supabase] — see #15
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = (await Promise.race([profilePromise, timeoutPromise])) as any;
                clearTimeout(initTimeoutId);
                const {
                  profileType: pt,
                  contactName: cn,
                  onboardingCompleted: oc,
                  needsApproval: na,
                  validationStatus: vs,
                } = result || {};
                profileType = pt;
                contactName = cn ?? null;
                onboardingCompleted = oc ?? false;
                shouldOnboard = !oc;
                needsApproval = na || false;
                validationStatus = vs;
              } catch (profileError) {
                log.error({ profileError }, 'Error fetching profile type');
                // Si timeout, continuer avec des valeurs par défaut
                if (getErrorMessage(profileError)?.includes('Timeout')) {
                  log.warn(
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
              contactName,
              onboardingCompleted,
              shouldOnboard,
              needsApproval,
              validationStatus,
              loading: false,
            });
          } catch (error) {
            log.error({ error }, 'Error initializing auth');
            // Toujours initialiser pour éviter le blocage
            set({
              user: null,
              initialized: true,
              profileType: null,
              contactName: null,
              onboardingCompleted: false,
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
            let profileType: string | null = null;
            let contactName: string | null = null;
            let onboardingCompleted = false;
            let shouldOnboard = false;

            let needsApproval = false;
            let validationStatus = undefined;

            if (user) {
              // Toujours appeler fetchProfileType pour obtenir le statut à jour depuis la DB
              const {
                profileType: pt,
                contactName: cn,
                onboardingCompleted: oc,
                needsApproval: na,
                validationStatus: vs,
              } = await fetchProfileType(user.id);
              profileType = pt;
              contactName = cn ?? null;
              onboardingCompleted = oc ?? false;
              shouldOnboard = !oc;
              needsApproval = na || false;
              validationStatus = vs;
            }

            set({
              user,
              loading: false,
              profileType,
              contactName,
              onboardingCompleted,
              shouldOnboard,
              needsApproval,
              validationStatus,
            });
          } catch (error) {
            set({
              loading: false,
              profileType: null,
              contactName: null,
              onboardingCompleted: false,
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
            // L'état persisté ("toodooh-auth") est remis à zéro via le set() ci-dessous;
            // persist se charge de l'écrire. (Les anciennes clés localStorage
            // user_profile_type / user_raison_social / user_validation_status /
            // onboardingCompleted / justOnboarded sont des orphelins inertes — pas de
            // migration, cf. la décision de scope du Step 3.)
            set({
              user: null,
              loading: false,
              profileType: null,
              contactName: null,
              onboardingCompleted: false,
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
            // Forcer le refresh depuis la DB (forceRefresh court-circuite les portes du cache)
            const {
              profileType,
              contactName,
              onboardingCompleted,
              needsApproval,
              validationStatus,
            } = await fetchProfileType(user.id, true);

            set({
              profileType,
              contactName: contactName ?? null,
              onboardingCompleted,
              shouldOnboard: !onboardingCompleted,
              needsApproval,
              validationStatus,
              loading: false,
            });
          } catch (error) {
            log.error({ error }, '❌ Error refreshing user status');
            set({ loading: false });
          }
        },
      };
    },
    {
      name: 'toodooh-auth',
      partialize: (state) => ({
        profileType: state.profileType,
        validationStatus: state.validationStatus,
        contactName: state.contactName,
        onboardingCompleted: state.onboardingCompleted,
      }),
    },
  ),
);
