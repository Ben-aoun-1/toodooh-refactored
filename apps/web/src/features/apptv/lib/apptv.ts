// APPTV-1 — the public /apptv download page's pinned contract. The APK path is a DEPLOY
// CONTRACT: nginx serves /downloads/toodooh-tv.apk (the binary is NOT in this repo; the
// architect places the file + the nginx location at deploy). The French copy is chartered.

export const APPTV_APK_HREF = '/downloads/toodooh-tv.apk';

export const APPTV_TITLE = "L'application TV Toodooh";
export const APPTV_PITCH = 'Diffusez les campagnes de votre établissement sur votre téléviseur.';
export const APPTV_DOWNLOAD_LABEL = "Télécharger l'APK (Android TV)";
export const APPTV_VERSION_LINE = 'Version 1.1.1';

export const APPTV_INSTALL_STEPS: readonly string[] = [
  'Autoriser les sources inconnues dans les paramètres de la TV.',
  'Transférer le fichier APK sur la TV (clé USB ou lien direct depuis le navigateur de la TV).',
  "Ouvrir le fichier et installer l'application.",
  "Lancer Toodooh TV et associer l'écran à votre établissement.",
];
