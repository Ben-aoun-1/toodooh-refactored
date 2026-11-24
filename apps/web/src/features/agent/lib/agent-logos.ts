import type { AgentLogo } from '../services/agent-logos.service';

// Agent specs VF « Logos » — the logo editor's wording, pure.

export const LOGO_ACCEPT = 'image/png,image/jpeg';
export const LOGO_SENT_TOAST = 'Logo envoyé, en attente de validation par Toodooh';

/** The line under « Logo de l'établissement » / « Logo du Screencaster ». */
export const logoStatusLine = (logo: AgentLogo | undefined, kind: 'screenhost' | 'screencaster') =>
  !logo
    ? kind === 'screenhost'
      ? "Aucun logo. Ajoutez-le lors de votre visite : fichier du gérant ou photo de l'enseigne."
      : 'Aucun logo. Ajoutez le fichier transmis par le Screencaster.'
    : logo.status === 'en_attente'
      ? 'En attente de validation par Toodooh.'
      : 'Validé par Toodooh.';

export const logoButtonLabel = (logo: AgentLogo | undefined) =>
  logo ? 'Changer le logo' : 'Ajouter le logo';

/** A file the editor can send: PNG or JPEG (the size in pixels is checked by the server). */
export const logoFileProblem = (file: { type: string; size: number }): string | null =>
  !LOGO_ACCEPT.split(',').includes(file.type)
    ? 'Formats acceptés : PNG, JPEG.'
    : file.size > 5 * 1024 * 1024
      ? 'Logo trop lourd (5 Mo maximum).'
      : null;
