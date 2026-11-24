// The Screencaster's own logo (Mariem 23/11 — same principle as the Agent's logos): the wording
// of the « Logo » block of his profile, pure. The file checks are the agent editor's
// (features/agent/lib/agent-logos: logoFileProblem, LOGO_ACCEPT) — one home, read from there.

export const OWN_LOGO_TITLE = 'Logo de votre entreprise';
export const OWN_LOGO_HINT = 'PNG ou JPEG, 400 × 400 px minimum, 5 Mo maximum.';
/** A Screencaster's own upload is validated at once: it shows on his campaigns straight away. */
export const OWN_LOGO_SAVED_TOAST = 'Logo enregistré';
export const OWN_LOGO_ERROR_TOAST = 'Envoi impossible';

/** The line under the block's title. */
export const ownLogoStatusLine = (hasLogo: boolean): string =>
  hasLogo
    ? 'Votre logo est affiché sur vos campagnes.'
    : 'Aucun logo. Ajoutez-le pour qu’il s’affiche sur vos campagnes.';

export const ownLogoButtonLabel = (hasLogo: boolean): string =>
  hasLogo ? 'Changer le logo' : 'Ajouter le logo';
