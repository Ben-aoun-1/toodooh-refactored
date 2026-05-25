import { ApiError } from '@/lib/api-client';

/**
 * Maps an {@link ApiError} (machine `code`) to a user-facing French message — the Phase-1f successor
 * to the Supabase-era `mapAuthError` (design §1.3 / ruling D2). The api-client throws domain-agnostic
 * `ApiError`s; the service/UI layer translates here, so the form contract (`getErrorMessage` → toast)
 * keeps working unchanged.
 *
 * `EMAIL_NOT_VERIFIED` MUST map to a correct verify-first message (ruling §11.6) — in the keystone,
 * that toast is how verify-first reaches the user; it must not fall through to the generic.
 *
 * Pure: no I/O, no side effects (same invariant as `lib/errors.ts`).
 */
const GENERIC = "Une erreur s'est produite. Veuillez réessayer dans quelques instants.";

export function apiErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;

  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return 'Email ou mot de passe incorrect.';
    case 'UNAUTHENTICATED':
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Veuillez vérifier votre adresse email avant de vous connecter. Consultez votre boîte mail (et le dossier spam).';
    case 'TAX_NUMBER_TAKEN':
      return 'Ce numéro de matricule fiscal est déjà enregistré.';
    case 'INVALID_TOKEN':
      return 'Ce lien est invalide ou a expiré. Veuillez recommencer.';
    case 'PAYLOAD_TOO_LARGE':
      return 'Le fichier est trop volumineux (maximum 5 Mo).';
    case 'STORAGE_ERROR':
      return 'Le stockage du document a échoué. Veuillez réessayer.';
    case 'NOT_FOUND':
      return 'La ressource demandée est introuvable.';
    case 'INVALID_INPUT': {
      const first = err.fields?.[0];
      return first
        ? `Champ invalide : ${first.field} — ${first.reason}.`
        : 'Certains champs sont invalides. Veuillez vérifier votre saisie.';
    }
    case 'NETWORK':
      return 'Problème de connexion. Vérifiez votre connexion internet et réessayez.';
    default:
      return GENERIC;
  }
}
