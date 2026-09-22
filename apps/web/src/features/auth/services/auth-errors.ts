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

// DOC-CAST1 — a 413 the API never wrote. The signup posts its documents as ONE multipart body, so a
// reverse proxy whose `client_max_body_size` is smaller than the ruled maximum (2 RNE + 10
// complémentaires × 5 Mo) answers its own HTML error page BEFORE Fastify: `toApiError` cannot parse
// it, `code` falls back to 'UNKNOWN', and the generic « réessayez dans quelques instants » would be a
// lie — resubmitting the same documents can never work. Name the real cause and the way out.
// Worded for EVERY surface this mapper serves (signup and the post-signin profile uploads alike),
// so it stays true wherever a proxy cap is hit — no signup-only « après inscription » tail.
const BODY_TOO_LARGE =
  'Vos documents sont trop volumineux pour être envoyés en une fois. Retirez-en quelques-uns ou réduisez leur taille, puis réessayez.';

export function apiErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;

  // Our own 413s carry a code and fall through to the switch; only a bodiless/HTML one lands here.
  if (err.status === 413 && err.code === 'UNKNOWN') return BODY_TOO_LARGE;

  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return 'Email ou mot de passe incorrect.';
    case 'UNAUTHENTICATED':
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Veuillez vérifier votre adresse email avant de vous connecter. Consultez votre boîte mail (et le dossier spam).';
    case 'TAX_NUMBER_TAKEN':
      return 'Ce numéro de matricule fiscal est déjà enregistré.';
    case 'EMAIL_TAKEN':
      return 'Cette adresse e-mail a déjà un compte.';
    case 'AGENT_CODE_UNKNOWN':
      return 'Aucun agent ne correspond à ce code.';
    case 'AGENT_CODE_INCOMPATIBLE':
      return "Ce code appartient à un agent d'un autre type.";
    case 'INVALID_TOKEN':
      return 'Ce lien est invalide ou a expiré. Veuillez recommencer.';
    case 'PAYLOAD_TOO_LARGE':
      return 'Le fichier est trop volumineux (maximum 5 Mo).';
    // DOC-CAST1 — the part COUNT, not a byte count: the signup route refuses more file parts than the
    // profile's slots allow. It used to borrow PAYLOAD_TOO_LARGE's message, which told a user who had
    // sent fifteen small files that one of them weighed too much.
    case 'TOO_MANY_FILES':
      return 'Trop de documents envoyés. Retirez-en quelques-uns et réessayez.';
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
